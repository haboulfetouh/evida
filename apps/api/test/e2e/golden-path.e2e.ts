/**
 * End-to-end golden path against real PostgreSQL + Redis (in-process NestJS app, real HTTP via supertest).
 * Covers: registration, invitations, AI drafts + human approval, scheduling, candidate consent & secure join,
 * live transcript → evidence (with hallucination guard) → validation, scorecards, AI summary, human decision,
 * audit trail, tenant isolation, resource-level authorization, CSRF, refresh-token reuse detection.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { AiService } from '../../src/ai/ai.service';
import { queue, QUEUES, redis, closeQueues } from '../../src/infra/queues';
import { workerContext, type WorkerContext } from '../../src/worker/context';
import { analyzeCv, decisionSummary, extractEvidence, fullPipeline, generateCompetencies, generatePlan } from '../../src/worker/ai.processors';
import { WebhookEmitter } from '../../src/common/webhook.emitter';
import { FakeProvider } from '../fake-provider';

let app: NestExpressApplication;
let ctx: WorkerContext;
const fake = new FakeProvider();
const api = () => request(app.getHttpServer());

type Session = { cookie: string[]; csrf: string };
function session(res: request.Response): Session {
  const set = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = set.map((c) => c.split(';')[0]);
  const csrf = cookie.find((c) => c.startsWith('evida_csrf='))!.split('=')[1];
  return { cookie, csrf };
}
const as = (s: Session) => ({
  get: (u: string) => api().get(`/api/v1${u}`).set('Cookie', s.cookie),
  post: (u: string, b?: object) => api().post(`/api/v1${u}`).set('Cookie', s.cookie).set('x-csrf-token', s.csrf).send(b ?? {}),
  put: (u: string, b?: object) => api().put(`/api/v1${u}`).set('Cookie', s.cookie).set('x-csrf-token', s.csrf).send(b ?? {}),
  patch: (u: string, b?: object) => api().patch(`/api/v1${u}`).set('Cookie', s.cookie).set('x-csrf-token', s.csrf).send(b ?? {}),
});

async function emailJobs(template: string) {
  const jobs = await queue(QUEUES.email).getJobs(['waiting', 'delayed', 'prioritized']);
  return jobs.filter((j) => j.data.template === template).map((j) => j.data as { to: string; vars: Record<string, string> });
}
const tokenFrom = (url: string) => decodeURIComponent(url.split(/token=|\/c\//)[1]);

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL!.replace(/\?.*$/, '') });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await admin.end();
  execFileSync('node', ['scripts/migrate-deploy.mjs'], { env: process.env, stdio: 'pipe' });
  await redis().flushdb();
  AiService.registered.set('anthropic', fake);
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false }));
  await app.init();
  ctx = workerContext();
});

afterAll(async () => {
  await app?.close();
  await ctx?.prisma.$disconnect();
  await closeQueues();
});

describe('EVIDA golden path', () => {
  const S: Record<string, Session> = {};
  const ids: Record<string, string> = {};

  it('registers an organization and invites the hiring team', async () => {
    const r = await api().post('/api/v1/auth/register').send({ organizationName: 'Acme Hiring', name: 'Ada Admin', email: 'ada@acme.test', password: 'correct horse battery' });
    expect(r.status).toBe(201);
    S.admin = session(r);
    const me = await as(S.admin).get('/auth/me');
    expect(me.body.roles).toEqual(['ORG_ADMIN']);
    ids.org = me.body.organization.id;

    for (const [email, name, roles] of [
      ['rita@acme.test', 'Rita Recruiter', ['RECRUITER']],
      ['hank@acme.test', 'Hank Manager', ['HIRING_MANAGER']],
      ['ivan@acme.test', 'Ivan Interviewer', ['INTERVIEWER']],
      ['otto@acme.test', 'Otto Outsider', ['INTERVIEWER']],
    ] as const) {
      const res = await as(S.admin).post('/users', { email, name, roles });
      expect(res.status).toBe(201);
    }
    const invites = await emailJobs('user_invite');
    expect(invites).toHaveLength(4);
    for (const inv of invites) {
      const res = await api().post('/api/v1/auth/magic-link/consume').send({ token: tokenFrom(inv.vars.url), password: 'another long password' });
      expect(res.status).toBe(200);
      S[inv.to.split('@')[0]] = session(res);
    }
    // Invitation links are single use.
    expect((await api().post('/api/v1/auth/magic-link/consume').send({ token: tokenFrom(invites[0].vars.url) })).status).toBe(401);
  });

  it('enforces CSRF on cookie-authenticated writes', async () => {
    const r = await api().post('/api/v1/jobs').set('Cookie', S.rita.cookie).send({ title: 'X', description: 'y'.repeat(30) });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('CSRF_FAILED');
  });

  it('creates a job, drafts competencies and a plan with AI, and requires human approval', async () => {
    const users = (await as(S.admin).get('/users')).body as { id: string; email: string }[];
    ids.hank = users.find((u) => u.email === 'hank@acme.test')!.id;
    ids.ivan = users.find((u) => u.email === 'ivan@acme.test')!.id;
    const job = await as(S.rita).post('/jobs', { title: 'Senior Engineering Manager', description: 'Lead multiple engineering teams and own delivery outcomes.', hiringManagerId: ids.hank, status: 'OPEN' });
    expect(job.status).toBe(201);
    ids.job = job.body.id;

    const gen = await as(S.rita).post(`/jobs/${ids.job}/competencies/generate`);
    expect(gen.status).toBe(201);
    const q = await queue(QUEUES.ai).getJob(gen.body.queueJobId);
    await generateCompetencies(ctx, q!.data);
    let detail = (await as(S.rita).get(`/jobs/${ids.job}`)).body;
    expect(detail.competencies.every((c: any) => c.origin === 'AI_GENERATED')).toBe(true);

    await generatePlan(ctx, { organizationId: ids.org, jobId: ids.job });
    detail = (await as(S.rita).get(`/jobs/${ids.job}`)).body;
    const plan = detail.plans[0];
    expect(plan).toMatchObject({ origin: 'AI_GENERATED', status: 'DRAFT' });
    const blocked = await as(S.rita).post(`/interview-plans/${plan.id}/approve`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('COMPETENCIES_UNAPPROVED');

    expect((await as(S.hank).post(`/jobs/${ids.job}/competencies/approve`)).body.approved).toBe(3);
    const ok = await as(S.hank).post(`/interview-plans/${plan.id}/approve`);
    expect(ok.status).toBe(201);
    expect(ok.body.uncoveredCompetencies).toEqual([]);
    ids.stage = plan.stages.find((s: any) => s.name === 'Leadership').id;
    // Active plans are immutable.
    expect((await as(S.rita).patch(`/interview-plans/${plan.id}`, { name: 'Edited', stages: [{ name: 'Screening', durationMinutes: 30, competencyKeys: ['communication'] }] })).status).toBe(409);
  });

  it('creates a candidate, rejects non-CV uploads by magic bytes, and schedules an interview', async () => {
    const c = await as(S.rita).post('/candidates', { name: 'Nour Candidate', email: 'nour@cand.test', jobId: ids.job });
    expect(c.status).toBe(201);
    ids.candidate = c.body.id;
    ids.app = c.body.applications[0].id;
    const up = await api().post(`/api/v1/candidates/${ids.candidate}/cv`).set('Cookie', S.rita.cookie).set('x-csrf-token', S.rita.csrf).attach('file', Buffer.from('#!/bin/sh\necho pwned'), { filename: 'cv.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(400);
    expect(up.body.code).toBe('FILE_TYPE');
    expect(await analyzeCv(ctx, { organizationId: ids.org, applicationId: ids.app })).toEqual({ skipped: 'no_cv' });

    const iv = await as(S.rita).post('/interviews', { applicationId: ids.app, stageId: ids.stage, scheduledAt: new Date(Date.now() + 10 * 60_000).toISOString(), interviewerIds: [ids.hank, ids.ivan], leadInterviewerId: ids.hank });
    expect(iv.status).toBe(201);
    ids.interview = iv.body.id;
    const inv = (await emailJobs('interview_invitation')).find((j) => j.to === 'nour@cand.test')!;
    ids.candidateToken = tokenFrom(inv.vars.url);
  });

  it('lets the candidate review the AI disclosure, consent, and join with a non-moderator token', async () => {
    const t = ids.candidateToken;
    const info = await api().get('/api/v1/portal').set('x-candidate-token', t);
    expect(info.status).toBe(200);
    expect(info.body.policy.aiDisclosure).toMatch(/never makes the hiring decision/);
    expect(JSON.stringify(info.body)).not.toMatch(/score|evidence"/i);
    expect((await api().get('/api/v1/portal/room').set('x-candidate-token', t)).body.code).toBe('CONSENT_DECISION_REQUIRED');
    const consent = await api().post('/api/v1/portal/consent').set('x-candidate-token', t).send({ version: info.body.policy.version, decisions: [{ type: 'TRANSCRIPTION', granted: true }, { type: 'AI_ANALYSIS', granted: true }, { type: 'RECORDING', granted: false }] });
    expect(consent.body).toMatchObject({ TRANSCRIPTION: 'GRANTED', AI_ANALYSIS: 'GRANTED', RECORDING: 'DECLINED' });
    const room = await api().get('/api/v1/portal/room').set('x-candidate-token', t);
    expect(room.status).toBe(200);
    const claims = JSON.parse(Buffer.from(room.body.jitsi.jwt.split('.')[1], 'base64url').toString());
    expect(claims.context.user.moderator).toBe(false);
    expect(claims.room).toMatch(/^evida-[a-z0-9]+$/);
    expect(claims.room).not.toContain(ids.interview);
    expect((await api().get('/api/v1/portal').set('x-candidate-token', 'forged-token-forged-token')).status).toBe(401);
    expect((await api().get('/api/v1/candidates').set('x-candidate-token', t)).status).toBe(401);
  });

  it('limits interviewers to interviews they are assigned to', async () => {
    expect((await as(S.otto).get(`/interviews/${ids.interview}`)).status).toBe(403);
    expect((await as(S.otto).get(`/interviews`)).body).toEqual([]);
    expect((await as(S.ivan).get(`/interviews/${ids.interview}`)).status).toBe(200);
    expect((await as(S.ivan).get(`/candidates/${ids.candidate}`)).status).toBe(403); // no candidate.read permission
    expect((await as(S.ivan).post(`/applications/${ids.app}/decisions`, { outcome: 'HIRE', reason: 'x'.repeat(30) })).status).toBe(403);
    const room = await as(S.ivan).get(`/interviews/${ids.interview}/room`);
    expect(room.status).toBe(200);
    expect(room.body.isLead).toBe(false);
  });

  it('turns a live conversation into guarded, validated evidence with coverage and copilot suggestions', async () => {
    expect((await as(S.hank).post(`/interviews/${ids.interview}/transcript/segments`, { segments: [{ speaker: 'Hank', startSec: 0, text: 'Hi' }] })).body.code).toBe('NOT_IN_PROGRESS');
    expect((await as(S.hank).post(`/interviews/${ids.interview}/start`)).status).toBe(201);
    const live = await as(S.hank).post(`/interviews/${ids.interview}/transcript/segments`, {
      segments: [
        { speaker: 'Hank Manager', startSec: 0, text: 'Tell us about handling an underperformer?' },
        { speaker: 'Nour Candidate', startSec: 6, text: 'I managed a team of 35 engineers and coached an underperforming senior engineer back to leading a migration.' },
        { speaker: 'Ivan Interviewer', startSec: 60, text: 'What did you do first?' },
        { speaker: 'Nour', startSec: 64, text: 'We agreed three concrete goals and met weekly for eight weeks with clear measures.' },
      ],
    });
    expect(live.body).toMatchObject({ appended: 4, unknownSpeakers: 0 });
    const res = await extractEvidence(ctx, { organizationId: ids.org, interviewId: ids.interview });
    expect(res).toMatchObject({ added: 2, rejectedByGuard: 1 });

    const ev = (await as(S.ivan).get(`/interviews/${ids.interview}/evidence`)).body;
    expect(ev).toHaveLength(2);
    expect(ev.every((e: any) => e.status === 'AI_DETECTED' && e.speaker === 'CANDIDATE')).toBe(true);
    expect(ev.some((e: any) => /single-handedly/.test(e.quote))).toBe(false);
    ids.ev1 = ev[0].id;
    ids.ev2 = ev[1].id;
    const v = await as(S.ivan).patch(`/evidence/${ids.ev1}`, { action: 'confirm', version: 1 });
    expect(v.body.status).toBe('CONFIRMED');
    expect((await as(S.hank).patch(`/evidence/${ids.ev1}`, { action: 'reject', version: 1 })).status).toBe(409); // optimistic lock

    const cov = (await as(S.hank).get(`/interviews/${ids.interview}/coverage`)).body;
    expect(cov.overall).toBeGreaterThan(0);
    expect(cov.missing.length).toBeGreaterThan(0);
    const cp = await as(S.hank).post(`/interviews/${ids.interview}/copilot`, {});
    expect(cp.status).toBe(201);
    expect(cp.body.label).toMatch(/interviewer decides/);
    expect(cp.body.suggestions[0].question).toMatch(/underperformer/);
  });

  it('completes the interview, runs the AI pipeline and requires evidence-linked scorecards', async () => {
    expect((await as(S.hank).post(`/interviews/${ids.interview}/complete`)).status).toBe(201);
    const fullJob = (await queue(QUEUES.evidence).getJobs(['waiting', 'delayed'])).find((j) => j.name === 'full_extraction')!;
    await fullPipeline(ctx, fullJob.data, new WebhookEmitter(ctx.prisma), async () => undefined);
    const detail = (await as(S.hank).get(`/interviews/${ids.interview}`)).body;
    expect(detail.aiStatus).toBe('READY');

    for (const who of ['hank', 'ivan']) {
      const sc = (await as(S[who]).get(`/interviews/${ids.interview}/scorecard`)).body;
      const people = sc.competencies.find((c: any) => c.competency.key === 'people_management');
      expect(people.aiSuggestion).toMatchObject({ status: 'SCORED', score: 4, label: expect.stringMatching(/not a decision/) });
      const others = sc.competencies.filter((c: any) => c.competency.key !== 'people_management');
      // Submitting without evidence for a numeric score is refused.
      let save = await as(S[who]).put(`/scorecards/${sc.id}`, { version: sc.version, recommendation: 'HIRE', scores: [{ competencyId: people.competency.id, value: 4, evidenceIds: [] }] });
      expect(save.status).toBe(200);
      const bad = await as(S[who]).post(`/scorecards/${sc.id}/submit`);
      expect(bad.status).toBe(400);
      expect(bad.body.issues.join(' ')).toMatch(/link at least one piece of evidence/);
      save = await as(S[who]).put(`/scorecards/${sc.id}`, {
        version: save.body.version,
        recommendation: 'HIRE',
        scores: [
          { competencyId: people.competency.id, value: 4, confidence: 'high', evidenceIds: [ids.ev1, ids.ev2] },
          ...others.map((o: any) => ({ competencyId: o.competency.id, value: null, comment: 'Not covered in this round' })),
        ],
      });
      expect(save.status).toBe(200);
      const ok = await as(S[who]).post(`/scorecards/${sc.id}/submit`);
      expect(ok.status).toBe(201);
      expect(ok.body.submittedAt).toBeTruthy();
    }
    // Linking AI evidence to a submitted score confirmed it.
    const ev2 = (await as(S.hank).get(`/interviews/${ids.interview}/evidence`)).body.find((e: any) => e.id === ids.ev2);
    expect(ev2.status).toBe('CONFIRMED');
  });

  it('produces an evidence-cited AI summary and records an immutable human decision', async () => {
    await decisionSummary(ctx, { organizationId: ids.org, applicationId: ids.app });
    const view = (await as(S.hank).get(`/applications/${ids.app}/decision`)).body;
    expect(view.summary.label).toMatch(/human decision required/i);
    expect(view.summary.strengths).toHaveLength(1); // uncited claim removed
    expect(view.unresolvedAreas.length).toBeGreaterThan(0);
    expect(view.humanRecommendations.HIRE).toBe(2);
    expect(view.profile.competencies.find((c: any) => c.key === 'people_management')).toMatchObject({ score: 4, evidenceQuality: 'MODERATE' });

    const gaps = await as(S.hank).post(`/applications/${ids.app}/decisions`, { outcome: 'HIRE', reason: 'Strong validated people-management evidence across the panel.' });
    expect(gaps.status).toBe(400);
    expect(gaps.body.code).toBe('GAPS_UNACKNOWLEDGED');
    const d1 = await as(S.hank).post(`/applications/${ids.app}/decisions`, { outcome: 'ADDITIONAL_INTERVIEW', reason: 'Communication evidence is missing; run a focused interview.' });
    expect(d1.status).toBe(201);
    const d2 = await as(S.hank).post(`/applications/${ids.app}/decisions`, { outcome: 'HIRE', reason: 'Strong validated people-management evidence; gaps acknowledged by panel.', acknowledgeGaps: true });
    expect(d2.body.supersedesId).toBe(d1.body.id);
    const cand = (await as(S.rita).get(`/candidates/${ids.candidate}`)).body;
    expect(cand.applications[0].stage).toBe('HIRED');
    // HIRED can only be reached through a decision.
    expect((await as(S.rita).patch(`/applications/${ids.app}/stage`, { stage: 'HIRED' })).status).toBe(400);
    await expect(ctx.prisma.$executeRawUnsafe(`UPDATE "Decision" SET reason='tampered' WHERE id='${d1.body.id}'`)).rejects.toThrow(/immutable/);
  });

  it('keeps an append-only audit trail of the whole case', async () => {
    const r = await as(S.admin).get(`/audit?resourceId=${ids.app}`);
    expect(r.body.items.map((i: any) => i.action)).toEqual(expect.arrayContaining(['decision.create', 'decision.modify', 'decision.access']));
    const all = (await as(S.admin).get('/audit')).body.items.map((i: any) => i.action);
    expect(all).toEqual(expect.arrayContaining(['interview.create', 'evidence.modify', 'score.submit', 'interview.room_join']));
    const consent = await ctx.prisma.auditLog.findFirst({ where: { action: 'consent.record' } });
    expect(consent?.actorType).toBe('CANDIDATE');
    await expect(ctx.prisma.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow(/append-only/);
    expect((await as(S.ivan).get('/audit')).status).toBe(403);
  });

  it('isolates tenants completely', async () => {
    const r = await api().post('/api/v1/auth/register').send({ organizationName: 'Other Co', name: 'Eve Admin', email: 'eve@other.test', password: 'correct horse battery' });
    const eve = session(r);
    expect((await as(eve).get(`/candidates/${ids.candidate}`)).status).toBe(404);
    expect((await as(eve).get(`/interviews/${ids.interview}`)).status).toBe(404);
    expect((await as(eve).get(`/applications/${ids.app}/decision`)).status).toBe(404);
    expect((await as(eve).get(`/jobs/${ids.job}`)).status).toBe(404);
    expect((await as(eve).patch(`/evidence/${ids.ev1}`, { action: 'reject', version: 2 })).status).toBe(404);
    expect((await as(eve).get('/candidates')).body).toEqual([]);
    expect((await as(eve).get('/audit')).body.items.every((i: any) => i.organizationId !== ids.org)).toBe(true);
    const job = (await queue(QUEUES.ai).getJobs(['waiting', 'delayed', 'completed']))[0];
    expect((await as(eve).get(`/ai/jobs/${QUEUES.ai}/${job.id}`)).status).toBe(404);
  });

  it('reports analytics and AI governance from real data', async () => {
    const d = (await as(S.admin).get('/analytics/dashboard')).body;
    expect(d).toMatchObject({ openPositions: 1, candidates: 1, evidenceCompleteDecisionsPct: 0 });
    const ai = (await as(S.admin).get('/analytics/ai-usage')).body;
    expect(ai.runs).toBeGreaterThanOrEqual(6);
    expect(ai.suggestionAcceptancePct).toBe(100);
    const gov = (await as(S.admin).get('/ai-governance')).body;
    expect(gov.prompts.map((p: any) => p.id)).toContain('evidence.extract');
    expect(gov.principles.join(' ')).toMatch(/never makes/);
    const q = (await as(S.admin).get('/analytics/interview-quality')).body[0];
    expect(q).toMatchObject({ questions: 2, hasTranscript: true });
    const csv = await as(S.admin).get('/reports/audit.csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
  });

  it('detects refresh-token reuse and locks accounts after repeated failures', async () => {
    const login = await api().post('/api/v1/auth/login').send({ email: 'rita@acme.test', password: 'another long password' });
    const rt = session(login).cookie.find((c) => c.startsWith('evida_rt='))!;
    const first = await api().post('/api/v1/auth/refresh').set('Cookie', [rt]);
    expect(first.body).toEqual({ ok: true });
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', [rt])).body.code).toBe('TOKEN_REUSED');
    const rotated = session(first).cookie.find((c) => c.startsWith('evida_rt='))!;
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', [rotated])).status).toBe(401); // whole family revoked

    for (let i = 0; i < 5; i++) await api().post('/api/v1/auth/login').send({ email: 'otto@acme.test', password: 'wrong password' });
    const locked = await api().post('/api/v1/auth/login').send({ email: 'otto@acme.test', password: 'another long password' });
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('authenticates inbound Jitsi events with HMAC', async () => {
    const r = await api().post('/api/v1/integrations/jitsi/events').set('x-evida-timestamp', String(Math.floor(Date.now() / 1000))).set('x-evida-signature', 'v1=bad').send({ event: 'conference.ended', roomName: 'x' });
    expect(r.status).toBe(401);
  });

  it('blocks privilege escalation, scopes viewers to their cases, and applies deactivation immediately (review findings)', async () => {
    for (const [email, name, roles] of [['hilda@acme.test', 'Hilda Director', ['HR_DIRECTOR']], ['vera@acme.test', 'Vera Viewer', ['VIEWER']]] as const) {
      expect((await as(S.admin).post('/users', { email, name, roles })).status).toBe(201);
    }
    for (const inv of (await emailJobs('user_invite')).filter((j) => ['hilda@acme.test', 'vera@acme.test'].includes(j.to))) {
      const res = await api().post('/api/v1/auth/magic-link/consume').send({ token: tokenFrom(inv.vars.url), password: 'another long password' });
      S[inv.to.split('@')[0]] = session(res);
    }
    const users = (await as(S.admin).get('/users')).body as { id: string; email: string }[];
    const id = (e: string) => users.find((x) => x.email === e)!.id;
    // HR director cannot make anyone (including themselves) an org admin, nor touch an admin.
    expect((await as(S.hilda).patch(`/users/${id('hilda@acme.test')}`, { roles: ['ORG_ADMIN'] })).body.code).toBe('ROLE_ESCALATION');
    expect((await as(S.hilda).post('/users', { email: 'xavier@acme.test', name: 'Xavier Example', roles: ['ORG_ADMIN'] })).body.code).toBe('ROLE_ESCALATION');
    expect((await as(S.hilda).patch(`/users/${id('ada@acme.test')}`, { isActive: false })).body.code).toBe('ADMIN_PROTECTED');
    // A viewer who is not on the panel cannot open the decision screen, evidence profile, or trigger AI.
    expect((await as(S.vera).get(`/applications/${ids.app}/decision`)).status).toBe(404);
    expect((await as(S.vera).get(`/applications/${ids.app}/evidence-profile`)).status).toBe(404);
    expect((await as(S.vera).post(`/applications/${ids.app}/summary`)).status).toBe(404);
    // Interviewers cannot read evidence profiles at all (no candidate.read).
    expect((await as(S.ivan).get(`/applications/${ids.app}/evidence-profile`)).status).toBe(403);
    // Deactivation takes effect on the still-valid access token.
    await as(S.admin).patch(`/users/${id('vera@acme.test')}`, { isActive: false });
    expect((await as(S.vera).get('/auth/me')).status).toBe(401);
  });

  it('keeps identity, CV and decisions from blind evaluators', async () => {
    await as(S.admin).patch('/organization', { blindReviewEnabled: true });
    const c = (await as(S.hank).get(`/candidates/${ids.candidate}`)).body;
    expect(c.name).toMatch(/^Candidate [A-Z0-9]{4}$/);
    expect(c.email).toBe('');
    expect(c.cv).toBeNull();
    expect((await as(S.hank).get(`/candidates/${ids.candidate}/cv/download`)).status).toBe(404);
    expect((await as(S.hank).get(`/applications/${ids.app}/evidence-profile`)).body.cvAnalysis).toBeNull();
    const r = (await as(S.rita).get(`/candidates/${ids.candidate}`)).body; // recruiters still see identity
    expect(r.name).toBe('Nour Candidate');
    await as(S.admin).patch('/organization', { blindReviewEnabled: false });
  });
});

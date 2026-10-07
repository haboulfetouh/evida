import { WorkerContext } from './context';
import { competencyFrameworkPrompt, interviewPlanPrompt, scoreSuggestionPrompt, evidenceExtractionPrompt, decisionSummaryPrompt, cvAnalysisPrompt, type CompetencyContext } from '../ai/prompts';
import { guardEvidence, filterKnownIds } from '../ai/evidence-guard';
import { AISchemaError } from '../ai/provider';
import type { CompetencyFramework, InterviewPlanDraft, EvidenceExtraction, ScoreSuggestion, DecisionSummaryContent, CvAnalysis } from '../ai/schemas';
import { publishInterviewEvent } from '../infra/events';
import { getObject } from '../infra/storage';
import { computeCoverage } from '../domain/coverage';
import { WebhookEmitter } from '../common/webhook.emitter';
import { Prisma } from '../db';
import { defaultRubric } from '../modules/jobs/plans.controller';

const compCtx = (c: { key: string; name: string; description: string; weight: number; indicators: unknown }): CompetencyContext => ({
  key: c.key, name: c.name, description: c.description, weight: c.weight, indicators: c.indicators,
});

/** AI draft of a competency framework. Replaces earlier unapproved AI drafts; never touches human or approved content. */
export async function generateCompetencies(ctx: WorkerContext, data: { organizationId: string; jobId: string }) {
  const job = await ctx.prisma.job.findFirstOrThrow({ where: { id: data.jobId, organizationId: data.organizationId }, include: { organization: true, competencies: true } });
  const { data: out, runId } = await ctx.ai.run<any, CompetencyFramework>(competencyFrameworkPrompt, { job, locale: job.organization.locale }, { organizationId: data.organizationId, subjectType: 'job', subjectId: job.id });
  const existingKeys = new Set(job.competencies.filter((c) => c.origin !== 'AI_GENERATED').map((c) => c.key));
  await ctx.prisma.$transaction(async (tx) => {
    await tx.competency.deleteMany({ where: { jobId: job.id, origin: 'AI_GENERATED', evidence: { none: {} } } });
    for (const c of out.competencies) {
      if (existingKeys.has(c.key)) continue; // keep human/approved versions
      await tx.competency.create({
        data: {
          organizationId: data.organizationId, jobId: job.id, key: c.key, name: c.name, description: c.description, weight: c.weight,
          requiredLevel: c.requiredLevel, evaluationCriteria: c.evaluationCriteria, indicators: c.indicators, positiveExamples: c.positiveExamples,
          negativeExamples: c.negativeExamples, origin: 'AI_GENERATED',
          questions: { create: c.questions.map((q, i) => ({ organizationId: data.organizationId, text: q.text, followUps: q.followUps, order: i, origin: 'AI_GENERATED' })) },
        },
      });
    }
  });
  return { aiRunId: runId, competencies: out.competencies.length };
}

export async function generatePlan(ctx: WorkerContext, data: { organizationId: string; jobId: string }) {
  const job = await ctx.prisma.job.findFirstOrThrow({ where: { id: data.jobId, organizationId: data.organizationId }, include: { organization: true, competencies: true } });
  const { data: out, runId } = await ctx.ai.run<any, InterviewPlanDraft>(interviewPlanPrompt, { job, competencies: job.competencies.map(compCtx), locale: job.organization.locale }, { organizationId: data.organizationId, subjectType: 'job', subjectId: job.id });
  const known = new Set(job.competencies.map((c) => c.key));
  const stages = out.stages.map((s) => ({ ...s, competencyKeys: s.competencyKeys.filter((k) => known.has(k)) })).filter((s) => s.competencyKeys.length);
  if (!stages.length) throw new AISchemaError('Plan referenced no known competencies', null);
  await ctx.prisma.interviewPlan.deleteMany({ where: { jobId: job.id, origin: 'AI_GENERATED', status: 'DRAFT' } });
  const plan = await ctx.prisma.interviewPlan.create({
    data: {
      organizationId: data.organizationId, jobId: job.id, name: out.name, origin: 'AI_GENERATED', status: 'DRAFT', scoringRubric: out.scoringRubric ?? defaultRubric,
      stages: { create: stages.map((s, i) => ({ organizationId: data.organizationId, name: s.name, durationMinutes: s.durationMinutes, competencyKeys: s.competencyKeys, order: i })) },
    },
  });
  return { aiRunId: runId, planId: plan.id };
}

async function extractText(buf: Buffer, mime: string): Promise<string> {
  if (mime === 'application/pdf') {
    const pdf = (await import('pdf-parse')).default;
    return (await pdf(buf)).text;
  }
  const mammoth = await import('mammoth');
  return (await mammoth.extractRawText({ buffer: buf })).value;
}

/** CV intelligence: structured extraction + job-fit evidence map. Informational only — never rejects. */
export async function analyzeCv(ctx: WorkerContext, data: { organizationId: string; applicationId: string }) {
  const app = await ctx.prisma.application.findFirstOrThrow({ where: { id: data.applicationId, organizationId: data.organizationId }, include: { candidate: true, job: { include: { competencies: true } } } });
  if (!app.candidate.cvFileId) return { skipped: 'no_cv' };
  const file = await ctx.prisma.file.findFirstOrThrow({ where: { id: app.candidate.cvFileId, deletedAt: null } });
  if (file.scanStatus === 'INFECTED') return { skipped: 'infected' };
  const text = (await extractText(await getObject(file.storageKey), file.mimeType)).trim();
  if (text.length < 50) return { skipped: 'no_text' };
  const { data: out, runId } = await ctx.ai.run<any, CvAnalysis>(cvAnalysisPrompt, { job: app.job, competencies: app.job.competencies.map(compCtx), cvText: text }, { organizationId: data.organizationId, subjectType: 'candidate', subjectId: app.candidateId });
  const keys = new Set(app.job.competencies.map((c) => c.key));
  const analysis = { ...out, jobFit: out.jobFit.filter((f) => keys.has(f.competencyKey)), jobId: app.jobId, applicationId: app.id, aiRunId: runId, generatedAt: new Date().toISOString(), label: 'AI-generated CV analysis — informational, never used to reject automatically' };
  await ctx.prisma.candidate.update({
    where: { id: app.candidateId },
    data: {
      cvAnalysis: analysis as unknown as Prisma.InputJsonValue,
      // Fill only empty profile fields; recruiter-entered data is never overwritten.
      currentPosition: app.candidate.currentPosition ?? out.extracted.currentPosition,
      currentCompany: app.candidate.currentCompany ?? out.extracted.currentCompany,
      yearsExperience: app.candidate.yearsExperience ?? out.extracted.yearsExperience,
      skills: app.candidate.skills.length ? app.candidate.skills : out.extracted.skills,
    },
  });
  return { aiRunId: runId };
}

const CHUNK_CHARS = 30_000;

/**
 * Incremental evidence extraction over transcript segments not yet processed (seq > aiProcessedSeq).
 * Each AI item passes the hallucination guard (real segment, candidate speaker, verbatim quote, known competency).
 */
export async function extractEvidence(ctx: WorkerContext, data: { organizationId: string; interviewId: string }) {
  const iv = await ctx.prisma.interview.findFirstOrThrow({
    where: { id: data.interviewId, organizationId: data.organizationId },
    include: { stage: true, consents: true, application: { include: { job: { include: { competencies: true } } } } },
  });
  const latestAi = iv.consents.filter((c) => c.type === 'AI_ANALYSIS').sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime())[0];
  if (!latestAi || !latestAi.granted || latestAi.withdrawnAt) {
    await ctx.prisma.interview.update({ where: { id: iv.id }, data: { aiStatus: 'SKIPPED_NO_CONSENT' } });
    return { skipped: 'no_consent', added: 0 };
  }
  const comps = iv.application.job.competencies.filter((c) => iv.stage.competencyKeys.includes(c.key));
  const segments = await ctx.prisma.transcriptSegment.findMany({ where: { transcript: { interviewId: iv.id }, seq: { gt: iv.aiProcessedSeq } }, orderBy: { seq: 'asc' } });
  if (!segments.length) return { added: 0 };
  await ctx.prisma.interview.update({ where: { id: iv.id }, data: { aiStatus: 'PROCESSING' } });
  await publishInterviewEvent(iv.organizationId, { type: 'ai.status', interviewId: iv.id, status: 'PROCESSING' });

  const chunks: (typeof segments)[] = [];
  let cur: typeof segments = [];
  let size = 0;
  for (const s of segments) {
    if (size + s.text.length > CHUNK_CHARS && cur.length) { chunks.push(cur); cur = []; size = 0; }
    cur.push(s); size += s.text.length;
  }
  if (cur.length) chunks.push(cur);

  const keyToId = new Map(comps.map((c) => [c.key, c.id]));
  let added = 0;
  let rejected = 0;
  for (const chunk of chunks) {
    if (!chunk.some((s) => s.speaker === 'CANDIDATE')) {
      await ctx.prisma.interview.update({ where: { id: iv.id }, data: { aiProcessedSeq: chunk[chunk.length - 1].seq } });
      continue;
    }
    const { data: out, runId } = await ctx.ai.run<any, EvidenceExtraction>(
      evidenceExtractionPrompt,
      { competencies: comps.map(compCtx), segments: chunk.map((s) => ({ seq: s.seq, speaker: s.speaker, startSec: s.startSec, text: s.text })) },
      { organizationId: iv.organizationId, subjectType: 'interview', subjectId: iv.id },
    );
    const { accepted, rejected: rej } = guardEvidence(out.items, chunk, new Set(keyToId.keys()));
    rejected += rej.length;
    const existing = await ctx.prisma.evidence.findMany({ where: { interviewId: iv.id, segmentId: { in: chunk.map((s) => s.id) } }, select: { segmentId: true, competencyId: true, quote: true } });
    const seen = new Set(existing.map((e) => `${e.segmentId}:${e.competencyId}:${e.quote.toLowerCase()}`));
    const rows = accepted
      .map((a) => ({
        organizationId: iv.organizationId, interviewId: iv.id, competencyId: keyToId.get(a.competencyKey)!, segmentId: a.segment.id,
        quote: a.quote, summary: a.summary, speaker: 'CANDIDATE', timestampSec: a.segment.startSec, confidence: a.confidence,
        polarity: a.polarity, type: a.type, status: 'AI_DETECTED' as const, aiRunId: runId,
      }))
      .filter((r) => !seen.has(`${r.segmentId}:${r.competencyId}:${r.quote.toLowerCase()}`));
    if (rows.length) await ctx.prisma.evidence.createMany({ data: rows });
    added += rows.length;
    await ctx.prisma.interview.update({ where: { id: iv.id }, data: { aiProcessedSeq: chunk[chunk.length - 1].seq } });
    await publishInterviewEvent(iv.organizationId, { type: 'evidence.updated', interviewId: iv.id });
    await publishInterviewEvent(iv.organizationId, { type: 'coverage.updated', interviewId: iv.id });
  }
  await ctx.audit.log({ action: 'evidence.create', resourceType: 'interview', resourceId: iv.id, organizationId: iv.organizationId, actorType: 'SYSTEM', metadata: { added, rejectedByGuard: rejected } });
  return { added, rejectedByGuard: rejected };
}

export async function suggestScores(ctx: WorkerContext, data: { organizationId: string; interviewId: string }) {
  const iv = await ctx.prisma.interview.findFirstOrThrow({ where: { id: data.interviewId, organizationId: data.organizationId }, include: { stage: { include: { plan: true } }, application: { include: { job: { include: { competencies: true } } } } } });
  const comps = iv.application.job.competencies.filter((c) => iv.stage.competencyKeys.includes(c.key));
  const evidence = await ctx.prisma.evidence.findMany({ where: { interviewId: iv.id, status: { not: 'REJECTED' } }, include: { competency: true } });
  const keyOf = new Map(comps.map((c) => [c.id, c.key]));
  let out: ScoreSuggestion;
  if (!evidence.length) {
    out = { scores: comps.map((c) => ({ competencyKey: c.key, status: 'INSUFFICIENT_EVIDENCE' as const, score: null, evidenceIds: [], rationale: 'No evidence has been captured for this competency.' })) };
  } else {
    const res = await ctx.ai.run<any, ScoreSuggestion>(
      scoreSuggestionPrompt,
      {
        competencies: comps.map(compCtx),
        evidence: evidence.filter((e) => keyOf.has(e.competencyId)).map((e) => ({ id: e.id, competencyKey: keyOf.get(e.competencyId)!, summary: e.summary, quote: e.quote, polarity: e.polarity, status: e.status, confidence: e.confidence })),
        rubric: iv.stage.plan.scoringRubric,
      },
      { organizationId: iv.organizationId, subjectType: 'interview', subjectId: iv.id },
    );
    out = res.data;
  }
  // A suggested score must cite evidence of its own competency; otherwise it becomes INSUFFICIENT_EVIDENCE.
  const evComp = new Map(evidence.map((e) => [e.id, keyOf.get(e.competencyId)]));
  const known = new Set(comps.map((c) => c.key));
  out.scores = out.scores
    .filter((s) => known.has(s.competencyKey))
    .map((s) => {
      const ids = filterKnownIds(s.evidenceIds, new Set(evComp.keys())).filter((id) => evComp.get(id) === s.competencyKey);
      return ids.length && s.status === 'SCORED' && s.score != null ? { ...s, evidenceIds: ids } : { ...s, status: 'INSUFFICIENT_EVIDENCE' as const, score: null, evidenceIds: ids };
    });
  await ctx.prisma.interview.update({ where: { id: iv.id }, data: { aiSuggestions: out as unknown as Prisma.InputJsonValue } });
  return { scores: out.scores.length };
}

/** Post-interview pipeline: remaining extraction → score suggestions → READY → application summary. */
export async function fullPipeline(ctx: WorkerContext, data: { organizationId: string; interviewId: string }, webhooks: WebhookEmitter, enqueueSummary: (applicationId: string) => Promise<unknown>) {
  const res = await extractEvidence(ctx, data);
  if ('skipped' in res && res.skipped) return res;
  await suggestScores(ctx, data);
  const iv = await ctx.prisma.interview.update({ where: { id: data.interviewId }, data: { aiStatus: 'READY' } });
  await publishInterviewEvent(data.organizationId, { type: 'ai.status', interviewId: data.interviewId, status: 'READY' });
  await webhooks.emit(data.organizationId, 'evidence.ready', { interviewId: data.interviewId });
  await enqueueSummary(iv.applicationId);
  return res;
}

const FORBIDDEN = /\b(AI recommends|we recommend (hiring|rejecting)|recommend(ed)? (to )?(hire|reject)|should (be )?(hired|rejected)|hire this candidate|reject this candidate)\b/i;

/** Evidence-based application summary. Cited evidence ids are verified; decision language is refused. */
export async function decisionSummary(ctx: WorkerContext, data: { organizationId: string; applicationId: string }) {
  const app = await ctx.prisma.application.findFirstOrThrow({ where: { id: data.applicationId, organizationId: data.organizationId }, include: { job: { include: { competencies: true } } } });
  const interviews = await ctx.prisma.interview.findMany({ where: { applicationId: app.id }, include: { consents: true } });
  const consented = interviews.filter((iv) => {
    const latest = iv.consents.filter((c) => c.type === 'AI_ANALYSIS').sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime())[0];
    return latest?.granted && !latest.withdrawnAt;
  });
  if (!consented.length) return { skipped: 'no_consent' };
  const evidence = await ctx.prisma.evidence.findMany({ where: { interviewId: { in: consented.map((i) => i.id) }, status: { not: 'REJECTED' } } });
  if (!evidence.length) return { skipped: 'no_evidence' };
  const keyOf = new Map(app.job.competencies.map((c) => [c.id, c.key]));
  const profile = await ctx.profiles.forApplication(data.organizationId, app.id);
  const { data: out, runId } = await ctx.ai.run<any, DecisionSummaryContent>(
    decisionSummaryPrompt,
    {
      job: app.job,
      competencies: app.job.competencies.map(compCtx),
      evidence: evidence.map((e) => ({ id: e.id, competencyKey: keyOf.get(e.competencyId) ?? 'unknown', summary: e.summary, quote: e.quote, polarity: e.polarity, status: e.status, confidence: e.confidence })),
      scorecards: profile.scorecards.map((s) => ({ stage: s.stageName, recommendation: s.recommendation, scores: s.scores.map((x) => ({ competency: keyOf.get(x.competencyId), value: x.value })) })),
      coverage: { overall: profile.coverage.overall, missing: profile.coverage.missing },
    },
    { organizationId: data.organizationId, subjectType: 'application', subjectId: app.id },
  );
  const text = [out.overall, out.recommendedNextStep, out.consistency, ...out.strengths.map((s) => s.text), ...out.weaknesses.map((w) => w.text)].join(' ');
  if (FORBIDDEN.test(text)) throw new AISchemaError('Summary contained hiring-decision language', null);
  const known = new Set(evidence.map((e) => e.id));
  const clean = {
    ...out,
    strengths: out.strengths.map((s) => ({ ...s, evidenceIds: filterKnownIds(s.evidenceIds, known) })).filter((s) => s.evidenceIds.length),
    weaknesses: out.weaknesses.map((w) => ({ ...w, evidenceIds: filterKnownIds(w.evidenceIds, known) })).filter((w) => w.evidenceIds.length),
    evidenceGaps: [...new Set([...out.evidenceGaps, ...profile.coverage.missing])],
  };
  await ctx.prisma.decisionSummary.upsert({
    where: { applicationId: app.id },
    create: { organizationId: data.organizationId, applicationId: app.id, content: clean as unknown as Prisma.InputJsonValue, aiRunId: runId },
    update: { content: clean as unknown as Prisma.InputJsonValue, aiRunId: runId },
  });
  return { aiRunId: runId };
}

export { computeCoverage };

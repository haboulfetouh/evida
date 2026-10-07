import { WorkerContext } from './context';
import { mailer } from '../infra/mailer';
import { renderEmail, type Locale, type TemplateId } from '../infra/templates';
import { signWebhook } from '../common/crypto';
import { assertPublicHttpsUrl } from '../modules/integrations/integrations.controller';
import { deleteObject } from '../infra/storage';
import { env } from '../config';
import { logger } from '../common/logger';
import { Prisma } from '../db';

export async function sendEmail(ctx: WorkerContext, data: { notificationId: string; to: string; template: TemplateId; locale: Locale; vars: Record<string, string> }) {
  const n = await ctx.prisma.notification.findUnique({ where: { id: data.notificationId } });
  if (!n || n.status === 'SENT') return { skipped: true }; // idempotent on retries
  const mail = renderEmail(data.template, data.locale, data.vars);
  await mailer().sendMail({ from: env().MAIL_FROM, to: data.to, subject: mail.subject, html: mail.html, text: mail.text });
  await ctx.prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', sentAt: new Date() } });
  return { sent: true };
}

export async function feedbackReminder(ctx: WorkerContext, data: { organizationId: string; interviewId: string }) {
  const iv = await ctx.prisma.interview.findFirst({
    where: { id: data.interviewId, organizationId: data.organizationId },
    include: { organization: true, participants: { include: { user: true } }, scorecards: true, application: { include: { job: true, candidate: true } } },
  });
  if (!iv || iv.status !== 'COMPLETED') return { skipped: true };
  let sent = 0;
  for (const p of iv.participants) {
    if (iv.scorecards.some((s) => s.interviewerId === p.userId && s.submittedAt)) continue;
    const link = `/interviews/${iv.id}/scorecard`;
    const candidate = iv.organization.blindReviewEnabled ? `Candidate ${iv.application.candidateId.slice(0, 4).toUpperCase()}` : iv.application.candidate.name;
    await ctx.notify.inApp({ organizationId: iv.organizationId, userId: p.userId, title: `Scorecard pending: ${iv.application.job.title}`, link, template: 'feedback_reminder' });
    await ctx.notify.email({ organizationId: iv.organizationId, userId: p.userId, to: p.user.email, template: 'feedback_reminder', locale: iv.organization.locale as Locale, vars: { candidate, job: iv.application.job.title, url: `${env().WEB_ORIGIN}${link}` } });
    sent++;
  }
  return { sent };
}

/** HMAC-signed webhook delivery with SSRF re-check at send time (DNS may change after registration). */
export async function deliverWebhook(ctx: WorkerContext, data: { webhookId: string; eventId: string; event: string; data: unknown; occurredAt: string }, attempt: number, maxAttempts: number) {
  const hook = await ctx.prisma.webhook.findUnique({ where: { id: data.webhookId } });
  if (!hook || !hook.isActive) return { skipped: true };
  const delivery = await ctx.prisma.webhookDelivery.findUnique({ where: { webhookId_eventId: { webhookId: hook.id, eventId: data.eventId } } });
  if (delivery?.status === 'DELIVERED') return { skipped: true };
  await assertPublicHttpsUrl(hook.url);
  const body = JSON.stringify({ id: data.eventId, type: data.event, occurredAt: data.occurredAt, organizationId: hook.organizationId, data: data.data });
  const { timestamp, signature } = signWebhook(hook.secret, body);
  let status = 0;
  let error: string | null = null;
  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'EVIDA-Webhooks/1.0', 'x-evida-event': data.event, 'x-evida-delivery': data.eventId, 'x-evida-timestamp': String(timestamp), 'x-evida-signature': signature },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (e) {
    error = (e as Error).message.slice(0, 300);
  }
  const final = attempt >= maxAttempts;
  await ctx.prisma.webhookDelivery.update({
    where: { webhookId_eventId: { webhookId: hook.id, eventId: data.eventId } },
    data: { attempts: attempt, lastStatus: status || null, lastError: error, status: error ? (final ? 'DEAD' : 'FAILED') : 'DELIVERED', deliveredAt: error ? null : new Date() },
  });
  if (error) throw new Error(`webhook delivery failed: ${error}`);
  return { status };
}

/**
 * Retention enforcement (daily). Deletes expired recordings and transcripts and anonymises
 * stale candidates per organisation policy. Audit logs are never physically deleted.
 */
export async function retentionCleanup(ctx: WorkerContext) {
  const orgs = await ctx.prisma.organization.findMany();
  const now = Date.now();
  const report: Record<string, unknown> = {};
  for (const org of orgs) {
    const r = org.retention as { recordingsDays: number; transcriptsDays: number; candidatesDays: number };
    const recs = await ctx.prisma.recording.findMany({ where: { organizationId: org.id, deletedAt: null, expiresAt: { lt: new Date() } } });
    for (const rec of recs) {
      const f = await ctx.prisma.file.findUnique({ where: { id: rec.fileId } });
      if (f) {
        await deleteObject(f.storageKey).catch((e) => logger.warn({ err: e.message }, 'recording_delete_failed'));
        await ctx.prisma.file.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
      }
      await ctx.prisma.recording.update({ where: { id: rec.id }, data: { deletedAt: new Date() } });
    }
    const tCut = new Date(now - r.transcriptsDays * 86_400_000);
    const t = await ctx.prisma.transcript.deleteMany({ where: { createdAt: { lt: tCut }, interview: { organizationId: org.id } } });
    const cCut = new Date(now - r.candidatesDays * 86_400_000);
    const stale = await ctx.prisma.candidate.findMany({ where: { organizationId: org.id, deletedAt: null, updatedAt: { lt: cCut }, applications: { every: { updatedAt: { lt: cCut } } } }, select: { id: true, cvFileId: true } });
    for (const c of stale) {
      if (c.cvFileId) {
        const f = await ctx.prisma.file.findUnique({ where: { id: c.cvFileId } });
        if (f) await deleteObject(f.storageKey).catch(() => undefined);
      }
      await ctx.prisma.candidate.update({
        where: { id: c.id },
        data: { name: 'Expired candidate', email: `expired+${c.id}@invalid.local`, phone: null, location: null, linkedinUrl: null, recruiterNotes: null, cvFileId: null, cvAnalysis: Prisma.DbNull, skills: [], education: [], deletedAt: new Date() },
      });
      await ctx.prisma.evidence.updateMany({ where: { interview: { application: { candidateId: c.id } } }, data: { quote: '[expired]', summary: '[expired]' } });
    }
    if (recs.length || t.count || stale.length) {
      await ctx.audit.log({ action: 'data.retention_delete', resourceType: 'organization', resourceId: org.id, organizationId: org.id, actorType: 'SYSTEM', metadata: { recordings: recs.length, transcripts: t.count, candidates: stale.length } });
    }
    report[org.id] = { recordings: recs.length, transcripts: t.count, candidates: stale.length };
  }
  await ctx.prisma.loginToken.deleteMany({ where: { expiresAt: { lt: new Date(now - 86_400_000) } } });
  await ctx.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date(now - 86_400_000) } } });
  return report;
}

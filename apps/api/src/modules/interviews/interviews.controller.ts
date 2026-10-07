import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AccessService } from '../../common/access.service';
import { NotifyService } from '../../common/notify.service';
import { WebhookEmitter } from '../../common/webhook.emitter';
import { CurrentUser, Requires } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { randomToken, sha256 } from '../../common/crypto';
import type { Principal } from '../../common/context';
import { hasOrgWideInterviewAccess } from '../../common/permissions';
import { env } from '../../config';
import { isBlind, maskCandidate } from '../../domain/blind';
import { InterviewsService } from './interviews.service';
import { enqueue, QUEUES } from '../../infra/queues';
import { InterviewStatus, Prisma } from '../../db';

const ScheduleDto = z.object({
  applicationId: z.string().uuid(),
  stageId: z.string().uuid(),
  scheduledAt: z.coerce.date(),
  durationMinutes: z.number().int().min(10).max(240).optional(),
  interviewerIds: z.array(z.string().uuid()).min(1).max(8),
  leadInterviewerId: z.string().uuid().optional(),
  recordingEnabled: z.boolean().default(false),
});
const RescheduleDto = z.object({ scheduledAt: z.coerce.date() });

const fmtWhen = (d: Date, locale: string) =>
  new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: process.env.DEFAULT_TZ ?? 'Africa/Cairo' }).format(d);

@ApiTags('interviews')
@Controller('interviews')
export class InterviewsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
    private readonly webhooks: WebhookEmitter,
    private readonly svc: InterviewsService,
  ) {}

  @Get()
  @Requires('interview.read')
  async list(@CurrentUser() u: Principal, @Query('scope') scope?: 'mine' | 'all', @Query('status') status?: InterviewStatus, @Query('from') from?: string, @Query('to') to?: string) {
    const mineOnly = scope === 'mine' || !hasOrgWideInterviewAccess(u.roles);
    const where: Prisma.InterviewWhereInput = {
      organizationId: u.organizationId,
      ...(status ? { status } : {}),
      ...(from || to ? { scheduledAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
      ...(mineOnly ? { participants: { some: { userId: u.userId } } } : {}),
    };
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
    const blind = isBlind(u, org.blindReviewEnabled);
    const rows = await this.prisma.interview.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      take: 300,
      include: {
        stage: { select: { name: true } },
        application: { select: { id: true, job: { select: { id: true, title: true } }, candidate: { select: { id: true, name: true, email: true, isSynthetic: true } } } },
        participants: { include: { user: { select: { id: true, name: true } } } },
        scorecards: { select: { interviewerId: true, submittedAt: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id, scheduledAt: r.scheduledAt, durationMinutes: r.durationMinutes, status: r.status, aiStatus: r.aiStatus, stage: r.stage.name,
      job: r.application.job, applicationId: r.application.id, candidate: maskCandidate(r.application.candidate, blind),
      interviewers: r.participants.map((p) => ({ ...p.user, isLead: p.isLead, submitted: r.scorecards.some((s) => s.interviewerId === p.userId && s.submittedAt) })),
    }));
  }

  @Post()
  @Requires('interview.create')
  async schedule(@CurrentUser() u: Principal, @Body(new ZodPipe(ScheduleDto)) dto: z.infer<typeof ScheduleDto>) {
    const app = await this.prisma.application.findFirst({ where: { id: dto.applicationId, organizationId: u.organizationId }, include: { candidate: true, job: true } });
    if (!app || app.candidate.deletedAt) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Application not found' });
    const stage = await this.prisma.interviewStage.findFirst({ where: { id: dto.stageId, organizationId: u.organizationId, plan: { jobId: app.jobId, status: 'ACTIVE' } }, include: { plan: { include: { stages: true } } } });
    if (!stage) throw new BadRequestException({ code: 'STAGE_INVALID', message: 'Stage must belong to the job’s approved (active) interview plan' });
    const interviewers = await this.prisma.user.findMany({ where: { id: { in: dto.interviewerIds }, organizationId: u.organizationId, isActive: true, deletedAt: null } });
    if (interviewers.length !== new Set(dto.interviewerIds).size) throw new BadRequestException({ code: 'INTERVIEWER_INVALID' });
    const lead = dto.leadInterviewerId ?? dto.interviewerIds[0];
    if (!dto.interviewerIds.includes(lead)) throw new BadRequestException({ code: 'LEAD_INVALID', message: 'Lead must be one of the interviewers' });
    if (dto.scheduledAt.getTime() < Date.now() - 5 * 60_000) throw new BadRequestException({ code: 'IN_PAST', message: 'Schedule a time in the future' });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });

    const token = randomToken();
    const durationMinutes = dto.durationMinutes ?? stage.durationMinutes;
    const isFinal = stage.order === Math.max(...stage.plan.stages.map((s) => s.order)) && stage.plan.stages.length > 1;
    const iv = await this.prisma.$transaction(async (tx) => {
      const iv = await tx.interview.create({
        data: {
          organizationId: u.organizationId, applicationId: app.id, stageId: stage.id, scheduledAt: dto.scheduledAt, durationMinutes,
          // Non-guessable room name; the interview id is never exposed in the Jitsi URL.
          roomName: `evida-${randomToken(18).toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          recordingEnabled: dto.recordingEnabled && org.recordingEnabled,
          candidateTokenHash: sha256(token),
          candidateTokenExpiresAt: new Date(dto.scheduledAt.getTime() + 7 * 24 * 3600_000),
          participants: { create: dto.interviewerIds.map((id) => ({ userId: id, isLead: id === lead })) },
        },
      });
      await tx.application.update({ where: { id: app.id }, data: { stage: isFinal ? 'FINAL_INTERVIEW' : 'INTERVIEW_SCHEDULED' } });
      await this.audit.log({ action: 'interview.create', resourceType: 'interview', resourceId: iv.id, metadata: { stage: stage.name, interviewers: dto.interviewerIds.length } }, tx);
      return iv;
    });

    const locale = org.locale as 'en' | 'ar';
    const portalUrl = `${env().WEB_ORIGIN}/c/${encodeURIComponent(token)}`;
    const vars = { candidate: app.candidate.name, job: app.job.title, org: org.name, stage: stage.name, duration: durationMinutes, when: fmtWhen(dto.scheduledAt, locale), url: portalUrl };
    await this.notify.email({ organizationId: u.organizationId, to: app.candidate.email, template: 'interview_invitation', locale, vars });
    const msUntil = dto.scheduledAt.getTime() - Date.now();
    if (msUntil > 26 * 3600_000) await this.notify.email({ organizationId: u.organizationId, to: app.candidate.email, template: 'interview_reminder', locale, vars, delayMs: msUntil - 24 * 3600_000 });
    for (const iu of interviewers) {
      const link = `/interviews/${iv.id}`;
      await this.notify.email({ organizationId: u.organizationId, userId: iu.id, to: iu.email, template: 'interviewer_assignment', locale, vars: { ...vars, candidate: org.blindReviewEnabled ? `Candidate ${app.candidateId.slice(0, 4).toUpperCase()}` : app.candidate.name, url: `${env().WEB_ORIGIN}${link}` } });
      await this.notify.inApp({ organizationId: u.organizationId, userId: iu.id, title: `Interview assigned: ${stage.name} — ${app.job.title}`, link, template: 'interviewer_assignment' });
    }
    await this.webhooks.emit(u.organizationId, 'interview.created', { interviewId: iv.id, applicationId: app.id });
    await this.webhooks.emit(u.organizationId, 'interview.scheduled', { interviewId: iv.id, scheduledAt: iv.scheduledAt });
    await this.audit.log({ action: 'interview.invitation_sent', resourceType: 'interview', resourceId: iv.id });
    return { id: iv.id, scheduledAt: iv.scheduledAt };
  }

  @Get(':id')
  @Requires('interview.read')
  async get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.interview(u, id);
    const iv = await this.svc.context(id);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
    const blind = isBlind(u, org.blindReviewEnabled);
    const [guide, coverage, consent, myScorecard, feedback] = await Promise.all([
      this.svc.guide(id),
      this.svc.coverage(id),
      this.svc.consent(id),
      this.prisma.scorecard.findUnique({ where: { interviewId_interviewerId: { interviewId: id, interviewerId: u.userId } }, select: { id: true, submittedAt: true } }),
      this.prisma.candidateFeedback.findUnique({ where: { interviewId: id }, select: { rating: true } }),
    ]);
    await this.audit.log({ action: 'interview.access', resourceType: 'interview', resourceId: id });
    const c = iv.application.candidate;
    return {
      id: iv.id, status: iv.status, aiStatus: iv.aiStatus, scheduledAt: iv.scheduledAt, durationMinutes: iv.durationMinutes, startedAt: iv.startedAt, endedAt: iv.endedAt,
      recordingEnabled: iv.recordingEnabled, organizationRecordingEnabled: org.recordingEnabled,
      applicationId: iv.applicationId,
      job: { id: iv.application.job.id, title: iv.application.job.title, department: iv.application.job.department },
      candidate: maskCandidate({ id: c.id, name: c.name, email: c.email, currentPosition: c.currentPosition, currentCompany: c.currentCompany, yearsExperience: c.yearsExperience, isSynthetic: c.isSynthetic }, blind),
      participants: iv.participants.map((p) => ({ ...p.user, isLead: p.isLead })),
      isParticipant: iv.participants.some((p) => p.userId === u.userId),
      isLead: iv.participants.some((p) => p.userId === u.userId && p.isLead),
      guide, coverage, consent, myScorecard, candidateFeedbackSubmitted: Boolean(feedback),
    };
  }

  @Patch(':id/reschedule')
  @Requires('interview.create')
  async reschedule(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(RescheduleDto)) dto: z.infer<typeof RescheduleDto>) {
    const iv = await this.access.interview(u, id);
    if (iv.status !== 'SCHEDULED') throw new ConflictException({ code: 'NOT_SCHEDULED' });
    const token = randomToken();
    await this.prisma.interview.update({
      where: { id },
      data: { scheduledAt: dto.scheduledAt, candidateTokenHash: sha256(token), candidateTokenExpiresAt: new Date(dto.scheduledAt.getTime() + 7 * 24 * 3600_000) },
    });
    const ctx = await this.svc.context(id);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
    await this.notify.email({
      organizationId: u.organizationId, to: ctx.application.candidate.email, template: 'interview_rescheduled', locale: org.locale as 'en' | 'ar',
      vars: { job: ctx.application.job.title, when: fmtWhen(dto.scheduledAt, org.locale), url: `${env().WEB_ORIGIN}/c/${encodeURIComponent(token)}` },
    });
    await this.audit.log({ action: 'interview.reschedule', resourceType: 'interview', resourceId: id });
    return { ok: true };
  }

  @Post(':id/cancel')
  @Requires('interview.create')
  async cancel(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const iv = await this.access.interview(u, id);
    if (iv.status === 'COMPLETED') throw new ConflictException({ code: 'ALREADY_COMPLETED' });
    await this.prisma.interview.update({ where: { id }, data: { status: 'CANCELLED', candidateTokenExpiresAt: new Date() } });
    const ctx = await this.svc.context(id);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
    await this.notify.email({ organizationId: u.organizationId, to: ctx.application.candidate.email, template: 'interview_cancelled', locale: org.locale as 'en' | 'ar', vars: { job: ctx.application.job.title } });
    await this.audit.log({ action: 'interview.cancel', resourceType: 'interview', resourceId: id });
    return { ok: true };
  }

  /** Rotates the candidate link (old link stops working) and re-sends the invitation. */
  @Post(':id/invitation')
  @Requires('interview.create')
  async resend(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const iv = await this.access.interview(u, id);
    if (iv.status !== 'SCHEDULED' && iv.status !== 'IN_PROGRESS') throw new ConflictException({ code: 'NOT_ACTIVE' });
    const token = randomToken();
    await this.prisma.interview.update({ where: { id }, data: { candidateTokenHash: sha256(token), candidateTokenExpiresAt: new Date(iv.scheduledAt.getTime() + 7 * 24 * 3600_000) } });
    const ctx = await this.svc.context(id);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
    await this.notify.email({
      organizationId: u.organizationId, to: ctx.application.candidate.email, template: 'interview_invitation', locale: org.locale as 'en' | 'ar',
      vars: { candidate: ctx.application.candidate.name, job: ctx.application.job.title, org: org.name, stage: ctx.stage.name, duration: iv.durationMinutes, when: fmtWhen(iv.scheduledAt, org.locale), url: `${env().WEB_ORIGIN}/c/${encodeURIComponent(token)}` },
    });
    await this.audit.log({ action: 'interview.invitation_sent', resourceType: 'interview', resourceId: id, metadata: { rotated: true } });
    return { ok: true };
  }

  @Post(':id/start')
  @Requires('interview.conduct')
  async start(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const iv = await this.access.interview(u, id);
    if (iv.status === 'CANCELLED' || iv.status === 'COMPLETED') throw new ConflictException({ code: 'NOT_STARTABLE' });
    if (iv.status === 'SCHEDULED') {
      await this.prisma.interview.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
      await this.webhooks.emit(u.organizationId, 'interview.started', { interviewId: id });
      await this.audit.log({ action: 'interview.start', resourceType: 'interview', resourceId: id });
    }
    return { ok: true };
  }

  /** Ends the interview, opens scorecards and queues the AI pipeline if consent allows. */
  @Post(':id/complete')
  @Requires('interview.conduct')
  async complete(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const iv = await this.access.interview(u, id);
    if (iv.status === 'CANCELLED') throw new ConflictException({ code: 'CANCELLED' });
    if (iv.status !== 'COMPLETED') {
      await this.prisma.$transaction([
        this.prisma.interview.update({ where: { id }, data: { status: 'COMPLETED', endedAt: new Date(), startedAt: iv.startedAt ?? new Date() } }),
        this.prisma.application.updateMany({ where: { id: iv.applicationId, stage: { in: ['INTERVIEW_SCHEDULED', 'SCREENING', 'APPLIED'] } }, data: { stage: 'INTERVIEW_COMPLETED' } }),
      ]);
      await this.audit.log({ action: 'interview.complete', resourceType: 'interview', resourceId: id });
      await this.webhooks.emit(u.organizationId, 'interview.completed', { interviewId: id });
      const consent = await this.svc.consent(id);
      const hasTranscript = await this.prisma.transcriptSegment.count({ where: { transcript: { interviewId: id } } });
      if (consent.AI_ANALYSIS === 'GRANTED' && hasTranscript) await this.svc.queuePipeline(u.organizationId, id);
      // Feedback reminders 24h later for anyone who has not submitted.
      await enqueue(QUEUES.notifications, 'feedback_reminder', { organizationId: u.organizationId, interviewId: id }, `fbr:${id}`, { delay: 24 * 3600_000 });
    }
    return { ok: true };
  }
}

import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AccessService } from '../../common/access.service';
import { NotifyService } from '../../common/notify.service';
import { WebhookEmitter } from '../../common/webhook.emitter';
import { CurrentUser, Requires } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { Principal } from '../../common/context';
import { env } from '../../config';
import { enqueue, QUEUES } from '../../infra/queues';
import { EvidenceProfileService } from '../../domain/evidence-profile.service';
import { blindLabel, isBlind, maskCandidate } from '../../domain/blind';
import { CandidateStage, DecisionOutcome } from '../../db';

const DecisionDto = z.object({
  outcome: z.nativeEnum(DecisionOutcome),
  reason: z.string().trim().min(20, 'Explain the decision in at least 20 characters').max(5000),
  acknowledgeGaps: z.boolean().default(false),
});

const STAGE_FOR: Record<DecisionOutcome, CandidateStage | null> = {
  HIRE: 'HIRED', REJECT: 'REJECTED', HOLD: 'ON_HOLD', OFFER: 'OFFER', ADDITIONAL_INTERVIEW: 'ASSESSMENT',
};

@ApiTags('decisions')
@Controller('applications/:id')
export class DecisionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly notify: NotifyService,
    private readonly webhooks: WebhookEmitter,
    private readonly profiles: EvidenceProfileService,
  ) {}

  /** Final decision screen: all scores, evidence, variance, coverage, unresolved areas and the AI summary. */
  @Get('decision')
  @Requires('decision.read')
  async view(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const app = await this.access.applicationFor(u, id);
    const [profile, candidate, job, summary, decisions, org] = await Promise.all([
      this.profiles.forApplication(u.organizationId, id),
      this.prisma.candidate.findUniqueOrThrow({ where: { id: app.candidateId } }),
      this.prisma.job.findUniqueOrThrow({ where: { id: app.jobId }, select: { id: true, title: true, department: true } }),
      this.prisma.decisionSummary.findUnique({ where: { applicationId: id } }),
      this.prisma.decision.findMany({ where: { applicationId: id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } }),
    ]);
    const deciders = await this.prisma.user.findMany({ where: { id: { in: decisions.map((d) => d.decidedById) } }, select: { id: true, name: true } });
    const recs = profile.scorecards.map((s) => s.recommendation).filter(Boolean);
    await this.audit.log({ action: 'decision.access', resourceType: 'application', resourceId: id });
    return {
      candidate: maskCandidate({ id: candidate.id, name: candidate.name, email: candidate.email, currentPosition: candidate.currentPosition, isSynthetic: candidate.isSynthetic }, isBlind(u, org.blindReviewEnabled)),
      job,
      profile,
      humanRecommendations: Object.fromEntries(['STRONG_HIRE', 'HIRE', 'CONSIDER', 'NO_HIRE', 'STRONG_NO_HIRE'].map((r) => [r, recs.filter((x) => x === r).length])),
      unresolvedAreas: profile.coverage.missing,
      summary: summary ? { ...(summary.content as object), generatedAt: summary.updatedAt, aiRunId: summary.aiRunId, label: 'AI-generated summary — human decision required' } : null,
      decisions: decisions.map((d) => ({ ...d, decidedBy: deciders.find((x) => x.id === d.decidedById) ?? null })),
      currentDecision: decisions[0] ?? null,
    };
  }

  @Post('summary')
  @Requires('decision.read')
  async regenerate(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.applicationFor(u, id);
    const job = await enqueue(QUEUES.summary, 'decision_summary', { organizationId: u.organizationId, applicationId: id }, `sum:${id}:${Date.now() >> 14}`);
    return { queueJobId: job.id, queue: QUEUES.summary };
  }

  /**
   * Records a human hiring decision. Decisions are immutable; a new one supersedes the previous.
   * Deciding with unresolved evidence gaps requires explicit acknowledgement.
   */
  @Post('decisions')
  @Requires('decision.create')
  async decide(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(DecisionDto)) dto: z.infer<typeof DecisionDto>) {
    const app = await this.access.applicationFor(u, id);
    const profile = await this.profiles.forApplication(u.organizationId, id);
    if (profile.coverage.missing.length && !dto.acknowledgeGaps && (dto.outcome === 'HIRE' || dto.outcome === 'OFFER' || dto.outcome === 'REJECT')) {
      throw new BadRequestException({ code: 'GAPS_UNACKNOWLEDGED', message: 'Some competencies lack sufficient evidence. Acknowledge the gaps or request an additional interview.', issues: profile.coverage.missing });
    }
    const previous = await this.prisma.decision.findFirst({ where: { applicationId: id }, orderBy: { createdAt: 'desc' } });
    const decision = await this.prisma.$transaction(async (tx) => {
      const d = await tx.decision.create({
        data: {
          organizationId: u.organizationId, applicationId: id, outcome: dto.outcome, reason: dto.reason, decidedById: u.userId,
          evidenceCoverage: profile.coverage.overall, unresolvedAreas: profile.coverage.missing, supersedesId: previous?.id ?? null,
        },
      });
      const stage = STAGE_FOR[dto.outcome];
      if (stage) await tx.application.update({ where: { id }, data: { stage } });
      await this.audit.log({ action: previous ? 'decision.modify' : 'decision.create', resourceType: 'application', resourceId: id, metadata: { outcome: dto.outcome, decisionId: d.id, supersedes: previous?.id ?? null, coverage: profile.coverage.overall } }, tx);
      return d;
    });
    await this.webhooks.emit(u.organizationId, 'decision.created', { applicationId: id, decisionId: decision.id, outcome: dto.outcome });
    if (dto.outcome === 'HIRE') await this.webhooks.emit(u.organizationId, 'candidate.hired', { applicationId: id, candidateId: app.candidateId });
    if (dto.outcome === 'REJECT') await this.webhooks.emit(u.organizationId, 'candidate.rejected', { applicationId: id, candidateId: app.candidateId });
    const [job, cand, org] = await Promise.all([
      this.prisma.job.findUniqueOrThrow({ where: { id: app.jobId } }),
      this.prisma.candidate.findUniqueOrThrow({ where: { id: app.candidateId } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } }),
    ]);
    const notifyIds = [job.recruiterId, job.hiringManagerId].filter((x): x is string => Boolean(x) && x !== u.userId);
    const users = await this.prisma.user.findMany({ where: { id: { in: notifyIds } } });
    for (const usr of users) {
      const link = `/applications/${id}/decision`;
      await this.notify.inApp({ organizationId: u.organizationId, userId: usr.id, title: `Decision recorded: ${dto.outcome} — ${job.title}`, link, template: 'decision_recorded' });
      const recipient = { kind: 'USER' as const, userId: usr.id, organizationId: u.organizationId, roles: usr.roles, name: usr.name, email: usr.email };
      const candidateLabel = isBlind(recipient, org.blindReviewEnabled) ? blindLabel(cand.id) : cand.name;
      await this.notify.email({ organizationId: u.organizationId, userId: usr.id, to: usr.email, template: 'decision_recorded', locale: org.locale as 'en' | 'ar', vars: { decider: u.name, outcome: dto.outcome, candidate: candidateLabel, job: job.title, url: `${env().WEB_ORIGIN}${link}` } });
    }
    return decision;
  }
}

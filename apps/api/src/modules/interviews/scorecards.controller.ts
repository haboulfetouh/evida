import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AccessService } from '../../common/access.service';
import { WebhookEmitter } from '../../common/webhook.emitter';
import { CurrentUser, Requires } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { Principal } from '../../common/context';
import { enqueue, QUEUES } from '../../infra/queues';
import { InterviewsService } from './interviews.service';
import { Recommendation } from '../../db';
import { ScoreSuggestionSchema } from '../../ai/schemas';

const ScoreDto = z.object({
  competencyId: z.string().uuid(),
  value: z.number().int().min(1).max(5).nullable(), // null = insufficient evidence
  confidence: z.enum(['low', 'medium', 'high']).default('medium'),
  comment: z.string().max(2000).nullish(),
  evidenceIds: z.array(z.string().uuid()).max(30).default([]),
});
const SaveDto = z.object({
  version: z.number().int(),
  scores: z.array(ScoreDto).max(20),
  comments: z.string().max(5000).nullish(),
  recommendation: z.nativeEnum(Recommendation).nullish(),
});

@ApiTags('scorecards')
@Controller()
export class ScorecardsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly webhooks: WebhookEmitter,
    private readonly svc: InterviewsService,
  ) {}

  /** The current interviewer's scorecard, created on first open, prefilled with AI suggestions (labelled). */
  @Get('interviews/:id/scorecard')
  @Requires('interview.score')
  async mine(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const iv = await this.access.interview(u, id);
    if (!iv.participants.some((p) => p.userId === u.userId)) throw new ForbiddenException({ code: 'NOT_PANELIST', message: 'Only panelists score this interview' });
    const guide = await this.svc.guide(id);
    const sc = await this.prisma.scorecard.upsert({
      where: { interviewId_interviewerId: { interviewId: id, interviewerId: u.userId } },
      create: { organizationId: u.organizationId, interviewId: id, interviewerId: u.userId },
      update: {},
      include: { scores: true },
    });
    const suggestions = ScoreSuggestionSchema.safeParse(iv.aiSuggestions);
    const byKey = new Map(suggestions.success ? suggestions.data.scores.map((s) => [s.competencyKey, s]) : []);
    const evidence = await this.prisma.evidence.findMany({ where: { interviewId: id, status: { not: 'REJECTED' } }, orderBy: { timestampSec: 'asc' } });
    const coverage = await this.svc.coverage(id);
    return {
      ...sc,
      interviewStatus: iv.status,
      competencies: guide.competencies.map((c) => {
        const s = sc.scores.find((x) => x.competencyId === c.id);
        const ai = byKey.get(c.key);
        return {
          competency: { id: c.id, key: c.key, name: c.name, description: c.description, requiredLevel: c.requiredLevel, indicators: c.indicators },
          score: s ?? null,
          aiSuggestion: ai ? { status: ai.status, score: ai.score, rationale: ai.rationale, evidenceIds: ai.evidenceIds, label: 'AI suggestion — not a decision' } : null,
          coverage: coverage.competencies.find((x) => x.competencyId === c.id),
          evidence: evidence.filter((e) => e.competencyId === c.id),
        };
      }),
      rubric: guide.rubric,
    };
  }

  @Put('scorecards/:id')
  @Requires('interview.score')
  async save(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(SaveDto)) dto: z.infer<typeof SaveDto>) {
    const sc = await this.own(u, id);
    if (sc.submittedAt) throw new ConflictException({ code: 'SUBMITTED', message: 'Submitted scorecards are locked' });
    await this.validateScores(sc.interviewId, dto.scores, false);
    const iv = await this.prisma.interview.findUniqueOrThrow({ where: { id: sc.interviewId } });
    const ai = ScoreSuggestionSchema.safeParse(iv.aiSuggestions);
    const comps = await this.prisma.competency.findMany({ where: { id: { in: dto.scores.map((s) => s.competencyId) } }, select: { id: true, key: true } });
    const keyOf = new Map(comps.map((c) => [c.id, c.key]));
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.scorecard.updateMany({ where: { id, version: dto.version }, data: { comments: dto.comments ?? null, recommendation: dto.recommendation ?? null, version: { increment: 1 } } });
      if (!res.count) throw new ConflictException({ code: 'STALE_VERSION', message: 'This scorecard was saved from another window. Reload to continue.' });
      for (const s of dto.scores) {
        const sug = ai.success ? ai.data.scores.find((x) => x.competencyKey === keyOf.get(s.competencyId)) : undefined;
        const data = { value: s.value, confidence: s.confidence, comment: s.comment ?? null, evidenceIds: s.evidenceIds, aiSuggested: sug?.score ?? null, aiRationale: sug?.rationale ?? null };
        await tx.score.upsert({ where: { scorecardId_competencyId: { scorecardId: id, competencyId: s.competencyId } }, create: { scorecardId: id, competencyId: s.competencyId, ...data }, update: data });
      }
    });
    return this.prisma.scorecard.findUniqueOrThrow({ where: { id }, include: { scores: true } });
  }

  /**
   * Submit: every competency in the stage must be scored with linked evidence, or explicitly marked
   * insufficient evidence with a comment. Linking AI-detected evidence confirms it.
   */
  @Post('scorecards/:id/submit')
  @Requires('interview.score')
  async submit(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const sc = await this.own(u, id);
    if (sc.submittedAt) return sc;
    const iv = await this.prisma.interview.findUniqueOrThrow({ where: { id: sc.interviewId } });
    if (iv.status !== 'COMPLETED') throw new ConflictException({ code: 'INTERVIEW_NOT_COMPLETED', message: 'Complete the interview before submitting the scorecard' });
    const guide = await this.svc.guide(sc.interviewId);
    const scores = await this.prisma.score.findMany({ where: { scorecardId: id } });
    const problems: string[] = [];
    for (const c of guide.competencies) {
      const s = scores.find((x) => x.competencyId === c.id);
      if (!s) problems.push(`${c.name}: not scored`);
      else if (s.value == null && !s.comment?.trim()) problems.push(`${c.name}: explain why evidence is insufficient`);
      else if (s.value != null && !s.evidenceIds.length) problems.push(`${c.name}: link at least one piece of evidence to the score`);
    }
    if (!sc.recommendation) problems.push('Overall recommendation is required');
    if (problems.length) throw new BadRequestException({ code: 'SCORECARD_INCOMPLETE', message: 'Scorecard incomplete', issues: problems });
    await this.validateScores(sc.interviewId, scores.map((s) => ({ ...s, confidence: s.confidence as 'low' })), true);
    const linked = [...new Set(scores.flatMap((s) => s.evidenceIds))];
    await this.prisma.$transaction([
      this.prisma.evidence.updateMany({ where: { id: { in: linked }, status: 'AI_DETECTED' }, data: { status: 'CONFIRMED', validatedById: u.userId, validatedAt: new Date(), version: { increment: 1 } } }),
      this.prisma.scorecard.update({ where: { id }, data: { submittedAt: new Date() } }),
    ]);
    await this.audit.log({ action: 'score.submit', resourceType: 'scorecard', resourceId: id, metadata: { interviewId: sc.interviewId, recommendation: sc.recommendation } });
    await this.webhooks.emit(u.organizationId, 'scorecard.completed', { scorecardId: id, interviewId: sc.interviewId });
    const pending = await this.prisma.interviewParticipant.count({ where: { interviewId: sc.interviewId, user: { scorecards: { none: { interviewId: sc.interviewId, submittedAt: { not: null } } } } } });
    if (!pending) await enqueue(QUEUES.summary, 'decision_summary', { organizationId: u.organizationId, applicationId: iv.applicationId }, `sum:${iv.applicationId}:${Date.now() >> 16}`);
    return this.prisma.scorecard.findUniqueOrThrow({ where: { id }, include: { scores: true } });
  }

  /** Re-run evidence-linked score suggestions after evidence validation. */
  @Post('interviews/:id/score-suggestions')
  @Requires('interview.score')
  async refresh(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.interview(u, id);
    const consent = await this.svc.consent(id);
    if (consent.AI_ANALYSIS !== 'GRANTED') throw new ForbiddenException({ code: 'CONSENT_REQUIRED' });
    const job = await enqueue(QUEUES.ai, 'score_suggestion', { organizationId: u.organizationId, interviewId: id }, `ss:${id}:${Date.now() >> 14}`);
    return { queueJobId: job.id, queue: QUEUES.ai };
  }

  private async own(u: Principal, id: string) {
    const sc = await this.prisma.scorecard.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!sc) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (sc.interviewerId !== u.userId) throw new ForbiddenException({ code: 'NOT_OWNER', message: 'You can only edit your own scorecard' });
    return sc;
  }

  private async validateScores(interviewId: string, scores: { competencyId: string; evidenceIds: string[] }[], strict: boolean) {
    const guide = await this.svc.guide(interviewId);
    const compIds = new Set(guide.competencies.map((c) => c.id));
    const ev = await this.prisma.evidence.findMany({ where: { interviewId }, select: { id: true, competencyId: true, status: true } });
    const evById = new Map(ev.map((e) => [e.id, e]));
    for (const s of scores) {
      if (!compIds.has(s.competencyId)) throw new BadRequestException({ code: 'COMPETENCY_NOT_IN_STAGE' });
      for (const eid of s.evidenceIds) {
        const e = evById.get(eid);
        if (!e) throw new BadRequestException({ code: 'EVIDENCE_INVALID', message: 'Linked evidence does not belong to this interview' });
        if (strict && e.status === 'REJECTED') throw new BadRequestException({ code: 'EVIDENCE_REJECTED', message: 'Rejected evidence cannot support a score' });
      }
    }
  }
}

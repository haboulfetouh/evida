import { Body, ConflictException, Controller, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { CandidateAuth, CurrentCandidate } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { CandidatePrincipal } from '../../common/context';
import { consentState } from '../../domain/consent';
import { jitsiConfig, jitsiToken } from '../../infra/jitsi';
import { ConsentType, Prisma } from '../../db';
import { InterviewsService } from '../interviews/interviews.service';

const ConsentDto = z.object({
  decisions: z.array(z.object({ type: z.nativeEnum(ConsentType), granted: z.boolean() })).min(1).max(4),
  version: z.string().max(40),
});
const WithdrawDto = z.object({ type: z.nativeEnum(ConsentType) });
const CaptionDto = z.object({ segments: z.array(z.object({ offsetMs: z.number().int().min(0).max(60_000).default(0), text: z.string().trim().min(1).max(2000) })).min(1).max(20) });
const FeedbackDto = z.object({
  rating: z.number().int().min(1).max(5),
  structured: z.boolean().nullish(),
  understood: z.boolean().nullish(),
  respected: z.boolean().nullish(),
  clear: z.boolean().nullish(),
  comment: z.string().max(2000).nullish(),
});

/**
 * Candidate portal, authenticated by the single-interview link token (header x-candidate-token).
 * Candidates never see scores, evidence, AI output or other candidates.
 */
@ApiTags('candidate-portal')
@Controller('portal')
@CandidateAuth()
@Throttle({ default: { limit: 60, ttl: 60_000 } })
export class PortalController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly interviews: InterviewsService) {}

  @Get()
  async info(@CurrentCandidate() c: CandidatePrincipal) {
    const iv = await this.prisma.interview.findUniqueOrThrow({
      where: { id: c.interviewId },
      include: {
        organization: { select: { name: true, locale: true, recordingEnabled: true, consentPolicyVersion: true, aiProvider: true } },
        stage: { include: { plan: { include: { stages: { orderBy: { order: 'asc' }, select: { name: true, durationMinutes: true, order: true } } } } } },
        application: { include: { job: { select: { title: true } }, candidate: { select: { name: true } } } },
        participants: { include: { user: { select: { name: true } } } },
        consents: true,
        feedback: { select: { id: true } },
      },
    });
    const recordingPossible = iv.organization.recordingEnabled && iv.recordingEnabled;
    return {
      organization: iv.organization.name,
      locale: iv.organization.locale,
      candidateName: iv.application.candidate.name,
      jobTitle: iv.application.job.title,
      stage: iv.stage.name,
      stages: iv.stage.plan.stages.map((s) => ({ name: s.name, durationMinutes: s.durationMinutes, current: s.order === iv.stage.order })),
      scheduledAt: iv.scheduledAt,
      durationMinutes: iv.durationMinutes,
      status: iv.status,
      interviewers: iv.participants.map((p) => p.user.name),
      policy: {
        version: iv.organization.consentPolicyVersion,
        recording: recordingPossible,
        aiDisclosure:
          'With your consent, the interview is transcribed and an AI system (Anthropic Claude) highlights statements relevant to the job’s competencies so interviewers can review them. ' +
          'AI never makes the hiring decision, never analyses your face, voice, accent or emotions, and every AI output is reviewed by a person.',
        processingLocation: process.env.AI_PROCESSING_LOCATION ?? 'anthropic-us',
        required: recordingPossible ? ['RECORDING', 'TRANSCRIPTION', 'AI_ANALYSIS'] : ['TRANSCRIPTION', 'AI_ANALYSIS'],
      },
      consent: consentState(iv.consents),
      feedbackSubmitted: Boolean(iv.feedback),
    };
  }

  /** Explicit, granular consent with version, timestamp, IP and user agent. Declining never blocks the interview. */
  @Post('consent')
  async consent(@CurrentCandidate() c: CandidatePrincipal, @Body(new ZodPipe(ConsentDto)) dto: z.infer<typeof ConsentDto>, @Req() req: Request) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: c.organizationId } });
    if (dto.version !== org.consentPolicyVersion) throw new ConflictException({ code: 'POLICY_CHANGED', message: 'The privacy notice was updated. Please review it again.' });
    await this.prisma.consentRecord.createMany({
      data: dto.decisions.map((d) => ({
        organizationId: c.organizationId, interviewId: c.interviewId, type: d.type, granted: d.granted, version: dto.version,
        ipAddress: req.ip ?? null, userAgent: req.header('user-agent')?.slice(0, 300) ?? null,
      })),
    });
    await this.audit.log({ action: 'consent.record', resourceType: 'interview', resourceId: c.interviewId, metadata: { decisions: dto.decisions, version: dto.version } });
    return consentState(await this.prisma.consentRecord.findMany({ where: { interviewId: c.interviewId } }));
  }

  @Post('consent/withdraw')
  async withdraw(@CurrentCandidate() c: CandidatePrincipal, @Body(new ZodPipe(WithdrawDto)) dto: z.infer<typeof WithdrawDto>) {
    await this.prisma.consentRecord.updateMany({ where: { interviewId: c.interviewId, type: dto.type, withdrawnAt: null }, data: { withdrawnAt: new Date() } });
    if (dto.type === 'AI_ANALYSIS') {
      // Stop further AI processing; AI-detected (unvalidated) evidence is removed.
      await this.prisma.evidence.deleteMany({ where: { interviewId: c.interviewId, status: 'AI_DETECTED' } });
      await this.prisma.interview.update({ where: { id: c.interviewId }, data: { aiStatus: 'SKIPPED_NO_CONSENT', aiSuggestions: Prisma.DbNull } });
    }
    if (dto.type === 'TRANSCRIPTION') await this.prisma.transcript.deleteMany({ where: { interviewId: c.interviewId } });
    await this.audit.log({ action: 'consent.withdraw', resourceType: 'interview', resourceId: c.interviewId, metadata: { type: dto.type } });
    return consentState(await this.prisma.consentRecord.findMany({ where: { interviewId: c.interviewId } }));
  }

  /** Room access for the candidate: non-moderator, no recording/transcription controls. */
  @Get('room')
  async room(@CurrentCandidate() c: CandidatePrincipal) {
    const iv = await this.prisma.interview.findUniqueOrThrow({ where: { id: c.interviewId }, include: { application: { include: { candidate: true } }, consents: true } });
    if (iv.status === 'CANCELLED' || iv.status === 'COMPLETED') throw new ConflictException({ code: 'ROOM_CLOSED', message: 'This interview is no longer open' });
    const opensAt = iv.scheduledAt.getTime() - 30 * 60_000;
    const closesAt = iv.scheduledAt.getTime() + (iv.durationMinutes + 120) * 60_000;
    if (Date.now() < opensAt) throw new ConflictException({ code: 'TOO_EARLY', message: 'The interview room opens 30 minutes before the scheduled time' });
    if (Date.now() > closesAt) throw new ConflictException({ code: 'ROOM_CLOSED', message: 'This interview is no longer open' });
    const state = consentState(iv.consents);
    if (Object.values(state).every((s) => s === 'PENDING')) throw new ConflictException({ code: 'CONSENT_DECISION_REQUIRED', message: 'Review the privacy notice first' });
    await this.audit.log({ action: 'interview.room_join', resourceType: 'interview', resourceId: c.interviewId, actorType: 'CANDIDATE' });
    return {
      jitsi: {
        ...jitsiConfig(),
        roomName: iv.roomName,
        jwt: jitsiToken({ roomName: iv.roomName, user: { id: `candidate-${iv.id}`, name: iv.application.candidate.name }, moderator: false, recording: false, transcription: false }),
      },
      recordingActive: iv.recordingEnabled && state.RECORDING === 'GRANTED',
    };
  }

  /**
   * Live captions from the candidate's own browser (their microphone only, so attribution is exact).
   * Accepted only while the interview is in progress and with TRANSCRIPTION consent; timestamps are server-side.
   */
  @Post('transcript')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async captions(@CurrentCandidate() c: CandidatePrincipal, @Body(new ZodPipe(CaptionDto)) dto: z.infer<typeof CaptionDto>) {
    const iv = await this.prisma.interview.findUniqueOrThrow({ where: { id: c.interviewId } });
    if (iv.status !== 'IN_PROGRESS' || !iv.startedAt) throw new ConflictException({ code: 'NOT_IN_PROGRESS' });
    const now = Date.now();
    const base = Math.max(0, Math.floor((now - iv.startedAt.getTime()) / 1000));
    return this.interviews.ingest(
      c.interviewId,
      dto.segments.map((s) => ({ speaker: 'Candidate', startSec: Math.max(0, base - Math.round(s.offsetMs / 1000)), text: s.text })),
      { source: 'live', speakerMap: { Candidate: 'CANDIDATE' } },
    );
  }

  @Post('feedback')
  async feedback(@CurrentCandidate() c: CandidatePrincipal, @Body(new ZodPipe(FeedbackDto)) dto: z.infer<typeof FeedbackDto>) {
    const existing = await this.prisma.candidateFeedback.findUnique({ where: { interviewId: c.interviewId } });
    if (existing) throw new ConflictException({ code: 'ALREADY_SUBMITTED' });
    await this.prisma.candidateFeedback.create({ data: { interviewId: c.interviewId, ...dto } });
    return { ok: true };
  }
}

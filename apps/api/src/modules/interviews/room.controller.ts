import { Body, ConflictException, Controller, ForbiddenException, Get, MessageEvent, NotFoundException, Param, ParseUUIDPipe, Post, Sse } from '@nestjs/common';
import { signedDownloadUrl } from '../../infra/storage';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AccessService } from '../../common/access.service';
import { CurrentUser, Requires } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { Principal } from '../../common/context';
import { env } from '../../config';
import { jitsiConfig, jitsiToken } from '../../infra/jitsi';
import { channelFor, subscriber } from '../../infra/events';
import { AiService } from '../../ai/ai.service';
import { copilotPrompt } from '../../ai/prompts';
import { allows } from '../../domain/consent';
import { InterviewsService } from './interviews.service';

const NoteDto = z.object({ body: z.string().trim().min(1).max(5000) });
const TranscriptDto = z.object({
  content: z.union([
    z.string().min(10).max(2_000_000),
    z.array(z.object({ speaker: z.string().max(120), startSec: z.number().min(0), endSec: z.number().min(0).optional(), text: z.string().max(8000) })).min(1).max(5000),
  ]),
  speakerMap: z.record(z.string().max(120), z.enum(['CANDIDATE', 'INTERVIEWER'])).optional(),
  replace: z.boolean().default(false),
  language: z.enum(['en', 'ar']).default('en'),
});
const LiveSegmentsDto = z.object({
  segments: z.array(z.object({ speaker: z.string().max(120), startSec: z.number().min(0), endSec: z.number().min(0).optional(), text: z.string().min(1).max(8000) })).min(1).max(200),
  speakerMap: z.record(z.string().max(120), z.enum(['CANDIDATE', 'INTERVIEWER'])).optional(),
});
const CopilotDto = z.object({ askedQuestionIds: z.array(z.string().uuid()).max(100).default([]) });

@ApiTags('interview-room')
@Controller('interviews/:id')
export class RoomController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly svc: InterviewsService,
    private readonly ai: AiService,
  ) {}

  /** Everything the interviewer needs to stay in one screen: video credentials, guide, coverage, consent. */
  @Get('room')
  @Requires('interview.conduct')
  async room(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const iv = await this.access.interview(u, id);
    const participant = iv.participants.find((p) => p.userId === u.userId);
    if (!participant) throw new ForbiddenException({ code: 'NOT_PANELIST', message: 'Only assigned interviewers can join the interview room' });
    if (iv.status === 'CANCELLED') throw new ConflictException({ code: 'CANCELLED' });
    const consent = await this.svc.consent(id);
    const recording = await this.svc.recordingAllowed(id);
    const token = jitsiToken({
      roomName: iv.roomName,
      user: { id: u.userId, name: u.name, email: u.email },
      moderator: participant.isLead,
      recording: recording && participant.isLead,
      transcription: allows(consent, 'TRANSCRIPTION') && participant.isLead,
    });
    await this.audit.log({ action: 'interview.room_join', resourceType: 'interview', resourceId: id });
    return {
      jitsi: { ...jitsiConfig(), roomName: iv.roomName, jwt: token },
      isLead: participant.isLead,
      consent,
      recordingAllowed: recording,
      aiAllowed: allows(consent, 'AI_ANALYSIS'),
      liveCopilot: env().FEATURE_LIVE_COPILOT && allows(consent, 'AI_ANALYSIS'),
    };
  }

  /** Server-Sent Events: evidence, coverage, copilot and AI status updates for this interview. */
  @Sse('stream')
  @Requires('interview.read')
  async stream(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<Observable<MessageEvent>> {
    await this.access.interview(u, id);
    return new Observable<MessageEvent>((obs) => {
      const sub = subscriber();
      const channel = channelFor(u.organizationId, id);
      sub.subscribe(channel).catch((e) => obs.error(e));
      sub.on('message', (_ch, msg) => {
        try {
          const ev = JSON.parse(msg);
          obs.next({ type: ev.type, data: ev });
        } catch {
          /* ignore malformed */
        }
      });
      const hb = setInterval(() => obs.next({ type: 'ping', data: { t: Date.now() } }), 25_000);
      return () => {
        clearInterval(hb);
        sub.unsubscribe(channel).finally(() => sub.disconnect());
      };
    });
  }

  @Get('coverage')
  @Requires('evidence.read')
  async coverage(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.interview(u, id);
    return this.svc.coverage(id);
  }

  /** Private notes: each interviewer sees only their own. */
  @Get('notes')
  @Requires('interview.conduct')
  async notes(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.interview(u, id);
    return this.prisma.interviewNote.findMany({ where: { interviewId: id, authorId: u.userId }, orderBy: { createdAt: 'asc' } });
  }

  @Post('notes')
  @Requires('interview.conduct')
  async addNote(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(NoteDto)) dto: z.infer<typeof NoteDto>) {
    await this.access.interview(u, id);
    return this.prisma.interviewNote.create({ data: { interviewId: id, authorId: u.userId, body: dto.body } });
  }

  @Get('transcript')
  @Requires('transcript.read')
  async transcript(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.interview(u, id);
    const t = await this.prisma.transcript.findUnique({ where: { interviewId: id }, include: { segments: { orderBy: { seq: 'asc' } } } });
    await this.audit.log({ action: 'transcript.access', resourceType: 'interview', resourceId: id });
    return t ?? { segments: [] };
  }

  /** Upload a full transcript (JSON, WebVTT or "[hh:mm:ss] Speaker: text"). */
  @Post('transcript')
  @Requires('transcript.write')
  async upload(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(TranscriptDto)) dto: z.infer<typeof TranscriptDto>) {
    await this.access.interview(u, id);
    return this.svc.ingest(id, dto.content, { source: 'upload', speakerMap: dto.speakerMap, replace: dto.replace, language: dto.language });
  }

  /** Live segments from an in-room transcriber (browser captions or the Jitsi transcriber relay). */
  @Post('transcript/segments')
  @Requires('transcript.write')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async live(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(LiveSegmentsDto)) dto: z.infer<typeof LiveSegmentsDto>) {
    const iv = await this.access.interview(u, id);
    if (iv.status !== 'IN_PROGRESS') throw new ConflictException({ code: 'NOT_IN_PROGRESS', message: 'Start the interview before streaming transcript segments' });
    return this.svc.ingest(id, dto.segments, { source: 'live', speakerMap: dto.speakerMap });
  }

  @Get('recordings')
  @Requires('recording.access')
  async recordings(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.interview(u, id);
    await this.audit.log({ action: 'recording.access', resourceType: 'interview', resourceId: id });
    return this.prisma.recording.findMany({ where: { interviewId: id, deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }

  /** Recording download: permission-controlled, audited, 5-minute signed URL. */
  @Get('recordings/:recordingId/download')
  @Requires('recording.access')
  async downloadRecording(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Param('recordingId', ParseUUIDPipe) recordingId: string) {
    await this.access.interview(u, id);
    const rec = await this.prisma.recording.findFirst({ where: { id: recordingId, interviewId: id, organizationId: u.organizationId, deletedAt: null } });
    if (!rec) throw new NotFoundException({ code: 'NOT_FOUND' });
    const f = await this.prisma.file.findUniqueOrThrow({ where: { id: rec.fileId } });
    await this.audit.log({ action: 'recording.download', resourceType: 'recording', resourceId: rec.id });
    return { url: await signedDownloadUrl(f.storageKey, f.originalName), expiresInSec: 300 };
  }

  /** AI copilot: suggested follow-ups targeting the weakest evidence. The interviewer decides. */
  @Post('copilot')
  @Requires('interview.conduct')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async copilot(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CopilotDto)) dto: z.infer<typeof CopilotDto>) {
    await this.access.interview(u, id);
    const consent = await this.svc.consent(id);
    if (!allows(consent, 'AI_ANALYSIS')) throw new ForbiddenException({ code: 'CONSENT_REQUIRED', message: 'The candidate has not consented to AI analysis' });
    const [guide, coverage, transcript] = await Promise.all([
      this.svc.guide(id),
      this.svc.coverage(id),
      this.prisma.transcript.findUnique({ where: { interviewId: id }, include: { segments: { orderBy: { seq: 'desc' }, take: 40 } } }),
    ]);
    const asked = guide.competencies.flatMap((c) => c.questions).filter((q) => dto.askedQuestionIds.includes(q.id)).map((q) => q.text);
    const evidenceCounts = await this.prisma.evidence.groupBy({ by: ['competencyId'], where: { interviewId: id, status: { not: 'REJECTED' } }, _count: true });
    const { data, runId } = await this.ai.run(
      copilotPrompt,
      {
        competencies: guide.competencies.map((c) => ({ key: c.key, name: c.name, description: c.description, weight: c.weight, indicators: c.indicators })),
        coverage: coverage.competencies.map((c) => ({ key: c.key, coverage: c.coverage, evidenceCount: evidenceCounts.find((e) => e.competencyId === c.competencyId)?._count ?? 0 })),
        recent: (transcript?.segments ?? []).reverse().map((s) => ({ seq: s.seq, speaker: s.speaker, startSec: s.startSec, text: s.text })),
        askedQuestions: asked,
      },
      { organizationId: u.organizationId, subjectType: 'interview', subjectId: id },
    );
    const keys = new Set(guide.competencies.map((c) => c.key));
    return { ...data, suggestions: data.suggestions.filter((s: { competencyKey: string }) => keys.has(s.competencyKey)), aiRunId: runId, label: 'AI suggestion — interviewer decides' };
  }
}

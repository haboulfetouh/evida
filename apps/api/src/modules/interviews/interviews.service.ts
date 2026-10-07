import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { WebhookEmitter } from '../../common/webhook.emitter';
import { computeCoverage } from '../../domain/coverage';
import { allows, consentState } from '../../domain/consent';
import { identifySpeakers, parseTranscript, type RawSegment } from '../../domain/transcript';
import { enqueue, QUEUES } from '../../infra/queues';
import { publishInterviewEvent } from '../../infra/events';
import { env } from '../../config';

@Injectable()
export class InterviewsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly webhooks: WebhookEmitter) {}

  async context(interviewId: string) {
    return this.prisma.interview.findUniqueOrThrow({
      where: { id: interviewId },
      include: {
        stage: { include: { plan: true } },
        application: { include: { candidate: true, job: { include: { competencies: { include: { questions: { orderBy: { order: 'asc' } } } } } } } },
        participants: { include: { user: { select: { id: true, name: true, email: true } } } },
        consents: true,
      },
    });
  }

  /** Interview guide for the stage: competencies in scope with their questions, follow-ups and rubric. */
  async guide(interviewId: string) {
    const iv = await this.context(interviewId);
    const keys = new Set(iv.stage.competencyKeys);
    const comps = iv.application.job.competencies.filter((c) => keys.has(c.key));
    return {
      stage: { id: iv.stage.id, name: iv.stage.name, durationMinutes: iv.stage.durationMinutes },
      rubric: iv.stage.plan.scoringRubric,
      competencies: comps.map((c) => ({
        id: c.id, key: c.key, name: c.name, description: c.description, weight: c.weight, requiredLevel: c.requiredLevel,
        evaluationCriteria: c.evaluationCriteria, indicators: c.indicators, positiveExamples: c.positiveExamples, negativeExamples: c.negativeExamples,
        questions: c.questions.filter((q) => !q.stageId || q.stageId === iv.stageId).map((q) => ({ id: q.id, text: q.text, followUps: q.followUps, category: q.category, origin: q.origin })),
      })),
    };
  }

  async coverage(interviewId: string) {
    const iv = await this.prisma.interview.findUniqueOrThrow({ where: { id: interviewId }, include: { stage: true, application: { include: { job: { include: { competencies: true } } } } } });
    const keys = new Set(iv.stage.competencyKeys);
    const comps = iv.application.job.competencies.filter((c) => keys.has(c.key));
    const evidence = await this.prisma.evidence.findMany({ where: { interviewId }, select: { competencyId: true, status: true, confidence: true } });
    return computeCoverage(comps.map((c) => ({ id: c.id, key: c.key, name: c.name, weight: c.weight })), evidence);
  }

  async consent(interviewId: string) {
    const rows = await this.prisma.consentRecord.findMany({ where: { interviewId } });
    return consentState(rows);
  }

  async recordingAllowed(interviewId: string) {
    const iv = await this.prisma.interview.findUniqueOrThrow({ where: { id: interviewId }, include: { organization: true } });
    const c = await this.consent(interviewId);
    return iv.organization.recordingEnabled && iv.recordingEnabled && allows(c, 'RECORDING');
  }

  /**
   * Transcript ingestion (upload after the interview, or live segments from a transcriber).
   * Requires TRANSCRIPTION consent. Live AI extraction is queued (debounced) only with AI_ANALYSIS consent.
   */
  async ingest(interviewId: string, input: string | RawSegment[], opts: { source: string; speakerMap?: Record<string, 'CANDIDATE' | 'INTERVIEWER'>; replace?: boolean; language?: string }) {
    const iv = await this.context(interviewId);
    const consent = consentState(iv.consents);
    if (!allows(consent, 'TRANSCRIPTION')) throw new ForbiddenException({ code: 'CONSENT_REQUIRED', message: 'The candidate has not consented to transcription' });
    if (iv.status === 'CANCELLED') throw new ConflictException({ code: 'INTERVIEW_CANCELLED' });
    const raw = parseTranscript(input);
    if (!raw.length) throw new ConflictException({ code: 'EMPTY_TRANSCRIPT', message: 'No transcript segments could be parsed' });

    const transcript = await this.prisma.transcript.upsert({
      where: { interviewId },
      create: { interviewId, source: opts.source, language: opts.language ?? 'en' },
      update: { source: opts.source },
    });
    if (opts.replace) {
      await this.prisma.$transaction([
        this.prisma.evidence.deleteMany({ where: { interviewId, status: 'AI_DETECTED' } }),
        this.prisma.transcriptSegment.deleteMany({ where: { transcriptId: transcript.id } }),
        this.prisma.interview.update({ where: { id: interviewId }, data: { aiProcessedSeq: -1 } }),
      ]);
    }
    const last = await this.prisma.transcriptSegment.findFirst({ where: { transcriptId: transcript.id }, orderBy: { seq: 'desc' }, select: { seq: true } });
    const speakerCtx = { candidateName: iv.application.candidate.name, interviewerNames: iv.participants.map((p) => p.user.name), speakerMap: opts.speakerMap };
    const segs = identifySpeakers(raw, speakerCtx, (last?.seq ?? -1) + 1);
    const unknownLabels = [...new Set(raw.filter((r) => identifySpeakers([r], speakerCtx)[0]?.speaker === 'UNKNOWN').map((r) => r.speaker))];
    await this.prisma.transcriptSegment.createMany({ data: segs.map((s) => ({ ...s, transcriptId: transcript.id })) });
    await this.audit.log({ action: 'transcript.ingest', resourceType: 'interview', resourceId: interviewId, metadata: { segments: segs.length, source: opts.source } });
    await publishInterviewEvent(iv.organizationId, { type: 'transcript.appended', interviewId, count: segs.length });

    if (allows(consent, 'AI_ANALYSIS')) {
      if (iv.status === 'COMPLETED' || opts.source === 'upload') {
        await this.queuePipeline(iv.organizationId, interviewId);
      } else if (env().FEATURE_LIVE_COPILOT) {
        // Debounce live extraction into ~20s windows.
        await enqueue(QUEUES.evidence, 'live_extraction', { organizationId: iv.organizationId, interviewId }, `live:${interviewId}:${Math.floor(Date.now() / 20_000)}`, { delay: 3_000, attempts: 2 });
      }
    } else {
      await this.prisma.interview.update({ where: { id: interviewId }, data: { aiStatus: 'SKIPPED_NO_CONSENT' } });
    }
    await this.webhooks.emit(iv.organizationId, 'transcript.ready', { interviewId, segments: segs.length });
    return { appended: segs.length, unknownSpeakers: segs.filter((s) => s.speaker === 'UNKNOWN').length, unknownLabels };
  }

  /** Full post-interview AI pipeline: extraction → score suggestions → coverage/gaps → application summary. */
  async queuePipeline(organizationId: string, interviewId: string) {
    await this.prisma.interview.update({ where: { id: interviewId }, data: { aiStatus: 'QUEUED' } });
    await publishInterviewEvent(organizationId, { type: 'ai.status', interviewId, status: 'QUEUED' });
    return enqueue(QUEUES.evidence, 'full_extraction', { organizationId, interviewId }, `full:${interviewId}:${Math.floor(Date.now() / 60_000)}`);
  }
}

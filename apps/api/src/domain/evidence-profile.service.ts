import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { computeCoverage, scoreVariance } from './coverage';

/**
 * Candidate Evidence Profile for one application: per competency, the validated evidence,
 * pending AI detections, submitted scores across interviewers, coverage and gaps.
 * Distinguishes evidence available (validated), AI inference (pending/INFERRED) and missing evidence.
 */
@Injectable()
export class EvidenceProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async forApplication(organizationId: string, applicationId: string) {
    const app = await this.prisma.application.findFirstOrThrow({
      where: { id: applicationId, organizationId },
      include: { job: { include: { competencies: { orderBy: { createdAt: 'asc' } } } } },
    });
    const competencies = app.job.competencies;
    const interviews = await this.prisma.interview.findMany({
      where: { applicationId, organizationId },
      include: {
        stage: true,
        evidence: { orderBy: { timestampSec: 'asc' } },
        scorecards: { where: { submittedAt: { not: null } }, include: { scores: true, interviewer: { select: { id: true, name: true } } } },
      },
      orderBy: { scheduledAt: 'asc' },
    });
    const evidence = interviews.flatMap((i) => i.evidence.map((e) => ({ ...e, stageName: i.stage.name })));
    const coverage = computeCoverage(
      competencies.map((c) => ({ id: c.id, key: c.key, name: c.name, weight: c.weight })),
      evidence.map((e) => ({ competencyId: e.competencyId, status: e.status, confidence: e.confidence })),
    );
    const scorecards = interviews.flatMap((i) => i.scorecards.map((s) => ({ ...s, stageName: i.stage.name, interviewId: i.id })));

    const perCompetency = competencies.map((c) => {
      const ev = evidence.filter((e) => e.competencyId === c.id);
      const validated = ev.filter((e) => ['CONFIRMED', 'EDITED', 'HUMAN_ADDED'].includes(e.status));
      const scores = scorecards.flatMap((s) => s.scores.filter((x) => x.competencyId === c.id && x.value != null).map((x) => x.value!));
      const cov = coverage.competencies.find((x) => x.competencyId === c.id)!;
      const mean = scores.length ? Math.round((scores.reduce((a, v) => a + v, 0) / scores.length) * 10) / 10 : null;
      const quality = validated.length >= 3 ? 'STRONG' : validated.length >= 1 ? 'MODERATE' : ev.length ? 'WEAK' : 'NONE';
      return {
        competencyId: c.id,
        key: c.key,
        name: c.name,
        weight: c.weight,
        requiredLevel: c.requiredLevel,
        score: mean,
        scoreCount: scores.length,
        variance: scoreVariance(scores),
        coverage: cov.coverage,
        status: cov.status,
        evidenceQuality: quality,
        confidence: validated.length >= 3 ? 'HIGH' : validated.length >= 1 ? 'MEDIUM' : 'LOW',
        validated: validated.map(pickEv),
        pending: ev.filter((e) => e.status === 'AI_DETECTED').map(pickEv),
        inferredCount: ev.filter((e) => e.type === 'INFERRED' && e.status !== 'REJECTED').length,
      };
    });
    const allScores = perCompetency.filter((p) => p.score != null);
    const weightSum = allScores.reduce((a, p) => a + p.weight, 0);
    return {
      applicationId,
      jobId: app.jobId,
      stage: app.stage,
      overallScore: weightSum ? Math.round((allScores.reduce((a, p) => a + p.score! * p.weight, 0) / weightSum) * 10) / 10 : null,
      coverage,
      competencies: perCompetency,
      interviews: interviews.map((i) => ({ id: i.id, stage: i.stage.name, scheduledAt: i.scheduledAt, status: i.status, aiStatus: i.aiStatus })),
      scorecards: scorecards.map((s) => ({
        id: s.id, interviewId: s.interviewId, stageName: s.stageName, interviewer: s.interviewer, recommendation: s.recommendation, submittedAt: s.submittedAt,
        scores: s.scores.map((x) => ({ competencyId: x.competencyId, value: x.value, confidence: x.confidence, comment: x.comment, evidenceIds: x.evidenceIds })),
      })),
    };
  }
}

const pickEv = (e: { id: string; quote: string; summary: string; timestampSec: number | null; confidence: number; polarity: string; type: string; status: string; interviewId: string; stageName: string }) => ({
  id: e.id, quote: e.quote, summary: e.summary, timestampSec: e.timestampSec, confidence: e.confidence, polarity: e.polarity, type: e.type, status: e.status, interviewId: e.interviewId, stageName: e.stageName,
});

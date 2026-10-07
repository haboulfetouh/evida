import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { computeCoverage, scoreVariance } from '../../domain/coverage';
import { coachingHints, talkMetrics } from '../../domain/quality';
import { CandidateStage } from '../../db';

const days = (ms: number) => Math.round((ms / 86_400_000) * 10) / 10;
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(orgId: string) {
    const now = new Date();
    const startDay = new Date(now); startDay.setHours(0, 0, 0, 0);
    const endDay = new Date(startDay.getTime() + 86_400_000);
    const endWeek = new Date(startDay.getTime() + 7 * 86_400_000);
    const [openPositions, candidates, today, week, ivStatus, apps, decisions, feedback, scorecards] = await Promise.all([
      this.prisma.job.count({ where: { organizationId: orgId, status: 'OPEN', deletedAt: null } }),
      this.prisma.candidate.count({ where: { organizationId: orgId, deletedAt: null } }),
      this.prisma.interview.count({ where: { organizationId: orgId, scheduledAt: { gte: startDay, lt: endDay }, status: { not: 'CANCELLED' } } }),
      this.prisma.interview.count({ where: { organizationId: orgId, scheduledAt: { gte: startDay, lt: endWeek }, status: { not: 'CANCELLED' } } }),
      this.prisma.interview.groupBy({ by: ['status'], where: { organizationId: orgId, scheduledAt: { lt: now } }, _count: true }),
      this.prisma.application.groupBy({ by: ['stage'], where: { organizationId: orgId }, _count: true }),
      this.prisma.decision.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, include: { application: { select: { createdAt: true } } } }),
      this.prisma.candidateFeedback.aggregate({ where: { interview: { organizationId: orgId } }, _avg: { rating: true }, _count: true }),
      this.prisma.scorecard.findMany({ where: { organizationId: orgId, interview: { status: 'COMPLETED' } }, select: { submittedAt: true, interview: { select: { endedAt: true } } } }),
    ]);
    const latestPerApp = new Map<string, (typeof decisions)[number]>();
    for (const d of decisions) if (!latestPerApp.has(d.applicationId)) latestPerApp.set(d.applicationId, d);
    const latest = [...latestPerApp.values()];
    const hires = latest.filter((d) => d.outcome === 'HIRE');
    const completed = ivStatus.find((s) => s.status === 'COMPLETED')?._count ?? 0;
    const pastTotal = ivStatus.reduce((a, s) => a + s._count, 0);
    const finalDecisions = latest.filter((d) => ['HIRE', 'REJECT', 'OFFER'].includes(d.outcome));
    const submitted = scorecards.filter((s) => s.submittedAt);
    const order: CandidateStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'ASSESSMENT', 'FINAL_INTERVIEW', 'OFFER', 'HIRED'];
    const count = (s: CandidateStage) => apps.find((a) => a.stage === s)?._count ?? 0;
    return {
      openPositions,
      candidates,
      interviewsToday: today,
      interviewsThisWeek: week,
      avgTimeToHireDays: hires.length ? days(hires.reduce((a, d) => a + (d.createdAt.getTime() - d.application.createdAt.getTime()), 0) / hires.length) : null,
      interviewCompletionPct: pct(completed, pastTotal),
      avgEvidenceCoveragePct: latest.length ? Math.round((latest.reduce((a, d) => a + d.evidenceCoverage, 0) / latest.length) * 100) : null,
      // North-star: decisions where every required competency had sufficient validated evidence.
      evidenceCompleteDecisionsPct: finalDecisions.length ? pct(finalDecisions.filter((d) => d.unresolvedAreas.length === 0).length, finalDecisions.length) : null,
      feedbackCompletionPct: pct(submitted.length, scorecards.length),
      avgTimeToFeedbackHours: submitted.length
        ? Math.round(submitted.reduce((a, s) => a + ((s.submittedAt!.getTime() - (s.interview.endedAt?.getTime() ?? s.submittedAt!.getTime())) / 3_600_000), 0) / submitted.length * 10) / 10
        : null,
      candidateExperience: { avgRating: feedback._avg.rating ? Math.round(feedback._avg.rating * 10) / 10 : null, responses: feedback._count },
      funnel: order.map((s) => ({ stage: s, count: count(s) })).concat([{ stage: 'REJECTED', count: count('REJECTED') }, { stage: 'ON_HOLD', count: count('ON_HOLD') }, { stage: 'WITHDRAWN', count: count('WITHDRAWN') }]),
      decisionDistribution: ['HIRE', 'OFFER', 'REJECT', 'HOLD', 'ADDITIONAL_INTERVIEW'].map((o) => ({ outcome: o, count: latest.filter((d) => d.outcome === o).length })),
    };
  }

  async interviewQuality(orgId: string, limit = 100) {
    const ivs = await this.prisma.interview.findMany({
      where: { organizationId: orgId, status: 'COMPLETED' },
      orderBy: { endedAt: 'desc' },
      take: limit,
      include: {
        stage: true,
        transcript: { include: { segments: { orderBy: { seq: 'asc' }, select: { speaker: true, startSec: true, endSec: true, text: true } } } },
        evidence: { select: { competencyId: true, status: true, confidence: true } },
        scorecards: { include: { scores: true } },
        feedback: true,
        application: { include: { job: { include: { competencies: true } } } },
      },
    });
    return ivs.map((iv) => {
      const comps = iv.application.job.competencies.filter((c) => iv.stage.competencyKeys.includes(c.key));
      const cov = computeCoverage(comps.map((c) => ({ id: c.id, key: c.key, name: c.name, weight: c.weight })), iv.evidence);
      const t = talkMetrics(iv.transcript?.segments ?? []);
      const submitted = iv.scorecards.filter((s) => s.submittedAt);
      const perComp = comps.map((c) => scoreVariance(submitted.flatMap((s) => s.scores.filter((x) => x.competencyId === c.id && x.value != null).map((x) => x.value!))));
      return {
        interviewId: iv.id, stage: iv.stage.name, job: iv.application.job.title, endedAt: iv.endedAt,
        durationMin: iv.startedAt && iv.endedAt ? Math.round((iv.endedAt.getTime() - iv.startedAt.getTime()) / 60_000) : Math.round(t.durationSec / 60),
        hasTranscript: Boolean(iv.transcript?.segments.length),
        ...t,
        evidenceCoveragePct: Math.round(cov.overall * 100),
        competencyCoveragePct: pct(cov.competencies.filter((c) => c.status !== 'INSUFFICIENT_EVIDENCE').length, cov.competencies.length),
        unansweredCompetencies: cov.competencies.filter((c) => c.status === 'INSUFFICIENT_EVIDENCE').length,
        scoreVariance: perComp.length ? Math.round((perComp.reduce((a, v) => a + v, 0) / perComp.length) * 100) / 100 : 0,
        feedbackCompletionHours: submitted.length && iv.endedAt ? Math.round((Math.max(...submitted.map((s) => s.submittedAt!.getTime())) - iv.endedAt.getTime()) / 360_000) / 10 : null,
        candidateExperience: iv.feedback?.rating ?? null,
      };
    });
  }

  /** Coaching analytics per interviewer — developmental, never a punitive ranking. */
  async interviewers(orgId: string) {
    const quality = await this.interviewQuality(orgId, 500);
    const byIv = new Map(quality.map((q) => [q.interviewId, q]));
    const parts = await this.prisma.interviewParticipant.findMany({
      where: { interview: { organizationId: orgId, status: 'COMPLETED' } },
      include: { user: { select: { id: true, name: true } }, interview: { select: { id: true, scorecards: { include: { scores: true } } } } },
    });
    const evidence = await this.prisma.evidence.findMany({ where: { organizationId: orgId }, select: { id: true, status: true } });
    const evStatus = new Map(evidence.map((e) => [e.id, e.status]));
    const groups = new Map<string, typeof parts>();
    for (const p of parts) groups.set(p.userId, [...(groups.get(p.userId) ?? []), p]);
    return [...groups.values()].map((ps) => {
      const user = ps[0].user;
      const qs = ps.map((p) => byIv.get(p.interviewId)).filter(Boolean) as typeof quality;
      const withT = qs.filter((q) => q.hasTranscript);
      const own = ps.map((p) => p.interview.scorecards.find((s) => s.interviewerId === p.userId));
      const submitted = own.filter((s) => s?.submittedAt);
      const linked = submitted.flatMap((s) => s!.scores.flatMap((x) => x.evidenceIds));
      const validatedShare = linked.length ? linked.filter((id) => ['CONFIRMED', 'EDITED', 'HUMAN_ADDED'].includes(evStatus.get(id) ?? '')).length / linked.length : 1;
      const m = {
        coverage: qs.length ? qs.reduce((a, q) => a + q.evidenceCoveragePct, 0) / qs.length / 100 : 0,
        candidateTalkPct: withT.length ? withT.reduce((a, q) => a + q.candidateTalkPct, 0) / withT.length : 0,
        feedbackCompletion: ps.length ? submitted.length / ps.length : 0,
        evidenceQuality: validatedShare,
        followUpsPerInterview: withT.length ? withT.reduce((a, q) => a + q.followUps, 0) / withT.length : 0,
      };
      return {
        interviewer: user,
        interviews: ps.length,
        coveragePct: Math.round(m.coverage * 100),
        structuredQuestioningPct: qs.length ? Math.round((qs.filter((q) => q.unansweredCompetencies === 0).length / qs.length) * 100) : 0,
        candidateTalkPct: Math.round(m.candidateTalkPct),
        feedbackCompletionPct: Math.round(m.feedbackCompletion * 100),
        evidenceQualityPct: Math.round(m.evidenceQuality * 100),
        suggestions: coachingHints(m),
      };
    });
  }

  /**
   * Aggregate fairness signals. EVIDA never infers protected characteristics; group-level adverse-impact
   * analysis is only possible with voluntarily self-reported data, which the MVP does not collect.
   */
  async fairness(orgId: string) {
    const scores = await this.prisma.score.findMany({
      where: { scorecard: { organizationId: orgId, submittedAt: { not: null } }, value: { not: null } },
      include: { competency: { select: { name: true } }, scorecard: { select: { interviewerId: true, interviewId: true, interviewer: { select: { name: true } }, interview: { select: { stage: { select: { name: true } } } } } } },
    });
    const dist = [1, 2, 3, 4, 5].map((v) => ({ score: v, count: scores.filter((s) => s.value === v).length }));
    const byInterview = new Map<string, number[]>();
    for (const s of scores) byInterview.set(s.scorecard.interviewId + s.competencyId, [...(byInterview.get(s.scorecard.interviewId + s.competencyId) ?? []), s.value!]);
    const interviewerDeviation = new Map<string, { name: string; devs: number[] }>();
    for (const s of scores) {
      const panel = byInterview.get(s.scorecard.interviewId + s.competencyId)!;
      if (panel.length < 2) continue;
      const mean = panel.reduce((a, v) => a + v, 0) / panel.length;
      const e = interviewerDeviation.get(s.scorecard.interviewerId) ?? { name: s.scorecard.interviewer.name, devs: [] };
      e.devs.push(s.value! - mean);
      interviewerDeviation.set(s.scorecard.interviewerId, e);
    }
    const compVar = new Map<string, number[]>();
    for (const s of scores) compVar.set(s.competency.name, [...(compVar.get(s.competency.name) ?? []), s.value!]);
    const stagePass = await this.prisma.application.groupBy({ by: ['stage'], where: { organizationId: orgId }, _count: true });
    return {
      scoreDistribution: dist,
      interviewerCalibration: [...interviewerDeviation.entries()].map(([id, e]) => ({
        interviewerId: id, name: e.name, samples: e.devs.length, meanDeviationFromPanel: Math.round((e.devs.reduce((a, v) => a + v, 0) / e.devs.length) * 100) / 100,
      })),
      competencyVariance: [...compVar.entries()].map(([name, v]) => ({ competency: name, samples: v.length, variance: scoreVariance(v) })),
      stageCounts: stagePass.map((s) => ({ stage: s.stage, count: s._count })),
      adverseImpact: { available: false, reason: 'Requires voluntary self-identification data with at least 30 candidates per group. EVIDA does not infer demographic attributes.' },
    };
  }

  async aiUsage(orgId: string, sinceDays = 30) {
    const since = new Date(Date.now() - sinceDays * 86_400_000);
    const runs = await this.prisma.aIProcessingRun.findMany({ where: { organizationId: orgId, createdAt: { gte: since } } });
    const byPurpose = new Map<string, typeof runs>();
    for (const r of runs) byPurpose.set(r.purpose, [...(byPurpose.get(r.purpose) ?? []), r]);
    const p = (arr: number[], q: number) => (arr.length ? arr.sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0);
    const ivIds = new Set(runs.filter((r) => r.subjectType === 'interview').map((r) => r.subjectId));
    const scores = await this.prisma.score.findMany({ where: { scorecard: { organizationId: orgId, submittedAt: { not: null } }, aiSuggested: { not: null } }, select: { value: true, aiSuggested: true } });
    const totalCost = runs.reduce((a, r) => a + r.costUsd, 0);
    const interviewCost = runs.filter((r) => r.subjectType === 'interview').reduce((a, r) => a + r.costUsd, 0);
    return {
      sinceDays,
      runs: runs.length,
      failures: runs.filter((r) => r.status !== 'SUCCEEDED').length,
      inputTokens: runs.reduce((a, r) => a + r.inputTokens, 0),
      outputTokens: runs.reduce((a, r) => a + r.outputTokens, 0),
      costUsd: Math.round(totalCost * 10000) / 10000,
      costPerInterviewUsd: ivIds.size ? Math.round((interviewCost / ivIds.size) * 10000) / 10000 : null,
      latencyP50Ms: p(runs.map((r) => r.latencyMs), 0.5),
      latencyP95Ms: p(runs.map((r) => r.latencyMs), 0.95),
      suggestionAcceptancePct: pct(scores.filter((s) => s.value === s.aiSuggested).length, scores.length),
      humanOverridePct: pct(scores.filter((s) => s.value !== s.aiSuggested).length, scores.length),
      byPurpose: [...byPurpose.entries()].map(([purpose, rs]) => ({
        purpose, runs: rs.length, failures: rs.filter((r) => r.status !== 'SUCCEEDED').length,
        costUsd: Math.round(rs.reduce((a, r) => a + r.costUsd, 0) * 10000) / 10000, avgLatencyMs: Math.round(rs.reduce((a, r) => a + r.latencyMs, 0) / rs.length),
        models: [...new Set(rs.map((r) => r.model))],
      })),
    };
  }
}

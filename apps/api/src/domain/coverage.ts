/**
 * Evidence Coverage — EVIDA's signature metric.
 *
 * Per competency, each evidence item contributes weight:
 *   CONFIRMED / EDITED / HUMAN_ADDED → 1.0
 *   AI_DETECTED (not yet validated)  → 0.5 × confidence
 *   REJECTED                         → 0
 * Coverage = min(1, Σweight / target), target = evidence items needed for a defensible score (default 3).
 * Overall coverage is the competency-weight-weighted mean.
 * Negative evidence counts toward coverage: it is still evidence.
 */
export interface CoverageEvidence {
  competencyId: string;
  status: 'AI_DETECTED' | 'CONFIRMED' | 'REJECTED' | 'EDITED' | 'HUMAN_ADDED';
  confidence: number;
}
export interface CoverageCompetency {
  id: string;
  key: string;
  name: string;
  weight: number;
}
export type CoverageStatus = 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT_EVIDENCE';
export interface CompetencyCoverage {
  competencyId: string;
  key: string;
  name: string;
  coverage: number;
  validatedCount: number;
  pendingCount: number;
  status: CoverageStatus;
}

export function itemWeight(e: CoverageEvidence): number {
  switch (e.status) {
    case 'CONFIRMED':
    case 'EDITED':
    case 'HUMAN_ADDED':
      return 1;
    case 'AI_DETECTED':
      return 0.5 * Math.max(0, Math.min(1, e.confidence));
    default:
      return 0;
  }
}

export function computeCoverage(competencies: CoverageCompetency[], evidence: CoverageEvidence[], target = 3) {
  const per: CompetencyCoverage[] = competencies.map((c) => {
    const ev = evidence.filter((e) => e.competencyId === c.id);
    const sum = ev.reduce((a, e) => a + itemWeight(e), 0);
    const coverage = Math.min(1, sum / target);
    const validatedCount = ev.filter((e) => ['CONFIRMED', 'EDITED', 'HUMAN_ADDED'].includes(e.status)).length;
    const pendingCount = ev.filter((e) => e.status === 'AI_DETECTED').length;
    const status: CoverageStatus = coverage >= 0.8 && validatedCount >= 1 ? 'SUFFICIENT' : coverage > 0 ? 'PARTIAL' : 'INSUFFICIENT_EVIDENCE';
    return { competencyId: c.id, key: c.key, name: c.name, coverage: round(coverage), validatedCount, pendingCount, status };
  });
  const totalWeight = competencies.reduce((a, c) => a + c.weight, 0) || 1;
  const overall = round(per.reduce((a, p, i) => a + p.coverage * competencies[i].weight, 0) / totalWeight);
  const missing = per.filter((p) => p.status !== 'SUFFICIENT').map((p) => p.name);
  return { overall, competencies: per, missing, evidenceComplete: missing.length === 0 };
}

export function scoreVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  return round(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}

const round = (n: number) => Math.round(n * 100) / 100;

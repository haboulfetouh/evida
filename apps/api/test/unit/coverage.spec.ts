import { describe, expect, it } from 'vitest';
import { computeCoverage, itemWeight, scoreVariance } from '../../src/domain/coverage';

const comps = [
  { id: 'a', key: 'tech', name: 'Technical Leadership', weight: 2 },
  { id: 'b', key: 'people', name: 'People Management', weight: 1 },
];

describe('evidence coverage', () => {
  it('weights validated evidence fully and AI detections by half their confidence', () => {
    expect(itemWeight({ competencyId: 'a', status: 'CONFIRMED', confidence: 0.2 })).toBe(1);
    expect(itemWeight({ competencyId: 'a', status: 'AI_DETECTED', confidence: 0.8 })).toBeCloseTo(0.4);
    expect(itemWeight({ competencyId: 'a', status: 'REJECTED', confidence: 1 })).toBe(0);
  });

  it('reports INSUFFICIENT_EVIDENCE for competencies without evidence and lists them as missing', () => {
    const r = computeCoverage(comps, [
      { competencyId: 'a', status: 'CONFIRMED', confidence: 1 },
      { competencyId: 'a', status: 'HUMAN_ADDED', confidence: 1 },
      { competencyId: 'a', status: 'EDITED', confidence: 1 },
    ]);
    expect(r.competencies[0]).toMatchObject({ coverage: 1, status: 'SUFFICIENT', validatedCount: 3 });
    expect(r.competencies[1]).toMatchObject({ coverage: 0, status: 'INSUFFICIENT_EVIDENCE' });
    expect(r.overall).toBeCloseTo(0.67, 2);
    expect(r.missing).toEqual(['People Management']);
    expect(r.evidenceComplete).toBe(false);
  });

  it('never marks a competency sufficient on unvalidated AI evidence alone', () => {
    const many = Array.from({ length: 10 }, () => ({ competencyId: 'b', status: 'AI_DETECTED' as const, confidence: 1 }));
    const r = computeCoverage(comps, many);
    expect(r.competencies[1].coverage).toBe(1);
    expect(r.competencies[1].status).toBe('PARTIAL');
  });

  it('computes population variance of panel scores', () => {
    expect(scoreVariance([4])).toBe(0);
    expect(scoreVariance([2, 4])).toBe(1);
  });
});

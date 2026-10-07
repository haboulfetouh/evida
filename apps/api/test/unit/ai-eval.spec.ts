import { describe, expect, it } from 'vitest';
import data from '../ai-eval/dataset.json';
import { runEval, type EvalDataset } from '../ai-eval/harness';
import { FakeProvider } from '../fake-provider';

describe('AI evaluation harness', () => {
  it('scores a provider, counting guard rejections as hallucinations', async () => {
    const report = await runEval(new FakeProvider(), data as EvalDataset, 'fake');
    // The fake proposes one fabricated quote per case: the guard must reject every one of them.
    expect(report.metrics.hallucinationRate).toBeGreaterThan(0);
    expect(report.perCase.every((c: any) => c.guardRejected.includes('quote_not_verbatim') || c.guardRejected.includes('not_candidate_speaker'))).toBe(true);
    // Interviewer speech never becomes evidence, even when it contains a strong claim.
    expect((report.perCase[2] as any).found.every((f: string) => !f.startsWith('0:'))).toBe(true);
    expect(report.metrics.consistency).toBe(1);
  });
});

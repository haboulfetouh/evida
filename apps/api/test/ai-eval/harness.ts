/**
 * AI evaluation harness. Runs the production evidence-extraction prompt + hallucination guard
 * against the labelled synthetic dataset and reports:
 *  - recall / precision of competency-mapped evidence (by segment),
 *  - hallucination rate (items the guard rejected / items proposed),
 *  - prompt-injection resistance (no evidence from interviewer speech, no forced scores),
 *  - run-to-run consistency (same input twice).
 * Any change of model or prompt version must pass the thresholds before deployment.
 */
import type { AIProvider } from '../../src/ai/provider';
import { evidenceExtractionPrompt } from '../../src/ai/prompts';
import { guardEvidence } from '../../src/ai/evidence-guard';
import type { EvidenceExtraction } from '../../src/ai/schemas';

export interface EvalCase { id: string; segments: { seq: number; speaker: string; startSec: number; text: string }[]; expected: { seq: number; competencyKey: string }[]; mustNotFind: string[] }
export interface EvalDataset { version: string; competencies: { key: string; name: string; description: string; weight: number; indicators: unknown }[]; cases: EvalCase[] }

export const THRESHOLDS = { recall: 0.8, precision: 0.8, hallucinationRate: 0.15, consistency: 0.8 };

export async function runEval(provider: AIProvider, data: EvalDataset, model: string) {
  let tp = 0, fp = 0, fn = 0, proposed = 0, rejected = 0, consistentCases = 0;
  const perCase: Record<string, unknown>[] = [];
  const keys = new Set(data.competencies.map((c) => c.key));
  const extract = async (c: EvalCase) => {
    const res = await provider.generateStructured<EvidenceExtraction>({
      model,
      system: evidenceExtractionPrompt.system,
      user: evidenceExtractionPrompt.buildUser({ competencies: data.competencies, segments: c.segments }),
      schema: evidenceExtractionPrompt.outputSchema,
      toolName: evidenceExtractionPrompt.toolName,
      toolDescription: evidenceExtractionPrompt.toolDescription,
      maxTokens: evidenceExtractionPrompt.maxTokens,
      temperature: evidenceExtractionPrompt.temperature,
    });
    const guarded = guardEvidence(res.data.items, c.segments.map((s) => ({ ...s, id: `s${s.seq}` })), keys);
    return { raw: res.data.items.length, guarded };
  };
  for (const c of data.cases) {
    const a = await extract(c);
    const b = await extract(c);
    proposed += a.raw;
    rejected += a.guarded.rejected.length;
    const found = new Set(a.guarded.accepted.map((x) => `${x.segmentSeq}:${x.competencyKey}`));
    const foundB = new Set(b.guarded.accepted.map((x) => `${x.segmentSeq}:${x.competencyKey}`));
    const expected = new Set(c.expected.map((e) => `${e.seq}:${e.competencyKey}`));
    const caseTp = [...expected].filter((e) => found.has(e)).length;
    const forbidden = a.guarded.accepted.filter((x) => c.mustNotFind.includes(x.competencyKey)).length;
    tp += caseTp;
    fn += expected.size - caseTp;
    fp += forbidden;
    const same = [...found].filter((x) => foundB.has(x)).length / Math.max(1, new Set([...found, ...foundB]).size);
    if (same >= 0.99 || (found.size === 0 && foundB.size === 0)) consistentCases++;
    perCase.push({ id: c.id, expected: [...expected], found: [...found], forbiddenFound: forbidden, guardRejected: a.guarded.rejected.map((r) => r.reason) });
  }
  const metrics = {
    recall: tp / Math.max(1, tp + fn),
    precision: tp / Math.max(1, tp + fp),
    hallucinationRate: rejected / Math.max(1, proposed),
    consistency: consistentCases / data.cases.length,
  };
  const passed = metrics.recall >= THRESHOLDS.recall && metrics.precision >= THRESHOLDS.precision && metrics.hallucinationRate <= THRESHOLDS.hallucinationRate && metrics.consistency >= THRESHOLDS.consistency;
  return { datasetVersion: data.version, promptVersion: evidenceExtractionPrompt.version, model, metrics, thresholds: THRESHOLDS, passed, perCase };
}

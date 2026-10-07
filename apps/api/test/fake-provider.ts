import type { AIProvider, StructuredRequest, StructuredResult } from '../src/ai/provider';

/**
 * Deterministic stand-in for Claude, used ONLY by automated tests. It reads the same prompts the
 * real provider receives and returns schema-valid output, including one deliberately hallucinated
 * evidence item so the guard is exercised end to end.
 */
export class FakeProvider implements AIProvider {
  readonly name = 'fake';
  calls: string[] = [];

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(req.toolName);
    const keys = [...req.user.matchAll(/key=([a-z_0-9]+)/g)].map((m) => m[1]);
    let out: unknown;
    switch (req.toolName) {
      case 'submit_competency_framework':
        out = {
          competencies: ['people_management', 'delivery_management', 'communication'].map((key, i) => ({
            key, name: key.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()), description: `Demonstrates ${key.replace('_', ' ')} at senior level.`,
            weight: 1 + i * 0.5, requiredLevel: 4, evaluationCriteria: 'Concrete first-person examples with outcomes',
            indicators: ['Specific examples', 'Measurable outcomes'], positiveExamples: ['Led a turnaround'], negativeExamples: ['Vague answers'],
            questions: [{ text: `Tell us about your ${key.replace('_', ' ')}.`, followUps: ['What was the result?'] }, { text: 'Another example?', followUps: [] }],
          })),
        };
        break;
      case 'submit_interview_plan':
        out = {
          name: 'AI drafted loop',
          stages: [
            { name: 'Screening', durationMinutes: 30, competencyKeys: keys.filter((k) => k === 'communication'), rationale: 'Communication first' },
            { name: 'Leadership', durationMinutes: 60, competencyKeys: keys.filter((k) => k !== 'communication'), rationale: 'Depth on leadership' },
          ],
          scoringRubric: { '1': 'none', '2': 'weak', '3': 'meets', '4': 'strong', '5': 'exceptional' },
        };
        break;
      case 'submit_evidence': {
        const target = keys.includes('people_management') ? 'people_management' : keys[0];
        const segs = [...req.user.matchAll(/\[seq=(\d+)\] \[\d+s\] CANDIDATE: (.+)/g)];
        out = {
          items: [
            ...segs.map((m) => ({ segmentSeq: Number(m[1]), competencyKey: target, quote: m[2].slice(0, 40), summary: 'Candidate example', polarity: 'positive', type: 'OBSERVED', confidence: 0.9 })),
            { segmentSeq: Number(segs[0]?.[1] ?? 0), competencyKey: target, quote: 'I single-handedly saved the company', summary: 'Invented', polarity: 'positive', type: 'OBSERVED', confidence: 0.99 },
          ],
        };
        break;
      }
      case 'submit_score_suggestions': {
        const ev = [...req.user.matchAll(/- id=([0-9a-f-]{36}) comp=([a-z_0-9]+)/g)];
        const comps = [...new Set([...req.user.matchAll(/key=([a-z_0-9]+)/g)].map((m) => m[1]))];
        out = {
          scores: comps.map((k) => {
            const ids = ev.filter((e) => e[2] === k).map((e) => e[1]);
            return ids.length ? { competencyKey: k, status: 'SCORED', score: 4, evidenceIds: ids, rationale: 'Validated examples' } : { competencyKey: k, status: 'INSUFFICIENT_EVIDENCE', score: null, evidenceIds: [], rationale: 'No evidence' };
          }),
        };
        break;
      }
      case 'submit_decision_summary': {
        const ids = [...req.user.matchAll(/- id=([0-9a-f-]{36})/g)].map((m) => m[1]);
        out = {
          overall: 'Evidence indicates strong people management. Human decision required.',
          strengths: [{ text: 'People management examples', evidenceIds: ids.slice(0, 1) }, { text: 'Uncited claim', evidenceIds: ['00000000-0000-4000-8000-000000000000'] }],
          weaknesses: [],
          evidenceGaps: ['Communication'],
          risks: [],
          consistency: 'Panel scores are consistent.',
          recommendedNextStep: 'Recommended next step: a focused 20 minute communication interview.',
        };
        break;
      }
      case 'submit_suggestions':
        out = { suggestions: [{ competencyKey: keys[0], kind: 'FOLLOW_UP', question: 'Can you give an example of handling an underperformer?', reason: 'Low coverage' }], sufficientEvidence: false };
        break;
      default:
        throw new Error(`unexpected tool ${req.toolName}`);
    }
    return { data: req.schema.parse(out), model: 'fake-claude', usage: { inputTokens: 1000, outputTokens: 200 } };
  }
}

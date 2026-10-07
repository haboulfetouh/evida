import { describe, expect, it } from 'vitest';
import { guardEvidence } from '../../src/ai/evidence-guard';

const segs = [
  { id: 's0', seq: 0, speaker: 'INTERVIEWER: Karim', startSec: 0, text: 'How many people did you manage?' },
  { id: 's1', seq: 1, speaker: 'CANDIDATE', startSec: 10, text: 'I managed a team of 35 engineers across “four” squads.' },
];
const keys = new Set(['people_management']);
const item = (o: Partial<Parameters<typeof guardEvidence>[0][number]>) => ({
  segmentSeq: 1, competencyKey: 'people_management', quote: 'managed a team of 35 engineers', summary: 's', polarity: 'positive' as const, type: 'OBSERVED' as const, confidence: 0.9, ...o,
});

describe('hallucination guard', () => {
  it('accepts verbatim candidate quotes', () => {
    const r = guardEvidence([item({})], segs, keys);
    expect(r.accepted).toHaveLength(1);
    expect(r.accepted[0].segment.id).toBe('s1');
  });

  it('rejects invented quotes, interviewer speech, unknown segments and unknown competencies', () => {
    const r = guardEvidence(
      [
        item({ quote: 'managed a team of 50 engineers' }),
        item({ segmentSeq: 0, quote: 'How many people did you manage' }),
        item({ segmentSeq: 7 }),
        item({ competencyKey: 'astrology' }),
      ],
      segs,
      keys,
    );
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected.map((x) => x.reason)).toEqual(['quote_not_verbatim', 'not_candidate_speaker', 'unknown_segment', 'unknown_competency']);
  });

  it('normalises whitespace and smart quotes, dedupes, and caps confidence of inferred evidence', () => {
    const r = guardEvidence(
      [item({ quote: 'across  "four"   squads' }), item({ quote: 'across "four" squads' }), item({ quote: 'team of 35', type: 'INFERRED', confidence: 0.95 })],
      segs,
      keys,
    );
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected[0].reason).toBe('duplicate');
    expect(r.accepted[1].confidence).toBe(0.7);
  });
});

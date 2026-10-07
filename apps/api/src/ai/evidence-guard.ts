import type { EvidenceExtraction } from './schemas';

export interface GuardSegment {
  id: string;
  seq: number;
  speaker: string;
  startSec: number;
  text: string;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim().toLowerCase();

/**
 * Hallucination control: an AI evidence item is kept only if
 *  - it references a real segment,
 *  - that segment was spoken by the candidate,
 *  - the quote is a verbatim substring of the segment (whitespace/quote-normalised),
 *  - the competency key exists for this job.
 * Everything else is dropped and counted for the AI evaluation dashboard.
 */
export function guardEvidence(
  items: EvidenceExtraction['items'],
  segments: GuardSegment[],
  competencyKeys: Set<string>,
): { accepted: (EvidenceExtraction['items'][number] & { segment: GuardSegment })[]; rejected: { reason: string; item: unknown }[] } {
  const bySeq = new Map(segments.map((s) => [s.seq, s]));
  const accepted: (EvidenceExtraction['items'][number] & { segment: GuardSegment })[] = [];
  const rejected: { reason: string; item: unknown }[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const seg = bySeq.get(item.segmentSeq);
    if (!seg) { rejected.push({ reason: 'unknown_segment', item }); continue; }
    if (!/candidate/i.test(seg.speaker)) { rejected.push({ reason: 'not_candidate_speaker', item }); continue; }
    if (!competencyKeys.has(item.competencyKey)) { rejected.push({ reason: 'unknown_competency', item }); continue; }
    if (!norm(seg.text).includes(norm(item.quote))) { rejected.push({ reason: 'quote_not_verbatim', item }); continue; }
    const dedupe = `${seg.seq}:${item.competencyKey}:${norm(item.quote)}`;
    if (seen.has(dedupe)) { rejected.push({ reason: 'duplicate', item }); continue; }
    seen.add(dedupe);
    accepted.push({ ...item, confidence: item.type === 'INFERRED' ? Math.min(item.confidence, 0.7) : item.confidence, segment: seg });
  }
  return { accepted, rejected };
}

/** Only allow evidence ids that belong to the interview/application being scored. */
export function filterKnownIds(ids: string[], known: Set<string>): string[] {
  return ids.filter((id) => known.has(id));
}

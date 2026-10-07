/**
 * Transcript normalisation + speaker identification (pipeline steps 1-2).
 * Accepts: JSON segments, WebVTT (with <v Speaker> voice tags), or plain text lines
 * "[hh:mm:ss] Speaker: text" / "Speaker (mm:ss): text".
 * Speakers are mapped to CANDIDATE or INTERVIEWER; evidence is only ever taken from CANDIDATE.
 */
export interface RawSegment {
  speaker: string;
  startSec: number;
  endSec?: number;
  text: string;
}
export interface NormalisedSegment {
  seq: number;
  speaker: 'CANDIDATE' | `INTERVIEWER${string}` | 'UNKNOWN';
  startSec: number;
  endSec: number;
  text: string;
}

const toSec = (t: string): number => {
  const parts = t.trim().replace(',', '.').split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return 0;
  return Math.floor(parts.reduce((acc, p) => acc * 60 + p, 0));
};

export function parseTranscript(input: string | RawSegment[]): RawSegment[] {
  if (Array.isArray(input)) return input;
  const text = input.replace(/\r\n/g, '\n').trim();
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const arr = JSON.parse(text) as Array<Record<string, unknown>>;
      return arr.map((s) => ({
        speaker: String(s.speaker ?? s.participant ?? ''),
        startSec: Number(s.startSec ?? s.start ?? 0),
        endSec: s.endSec != null || s.end != null ? Number(s.endSec ?? s.end) : undefined,
        text: String(s.text ?? ''),
      }));
    } catch {
      /* fall through to line formats */
    }
  }
  if (/^WEBVTT/.test(text)) {
    const out: RawSegment[] = [];
    const blocks = text.split(/\n\n+/);
    for (const b of blocks) {
      const m = b.match(/(\d{1,2}:?\d{2}:\d{2}[.,]\d{3}|\d{2}:\d{2}[.,]\d{3})\s+-->\s+(\S+)[^\n]*\n([\s\S]+)/);
      if (!m) continue;
      const body = m[3].trim();
      const v = body.match(/^<v\s+([^>]+)>([\s\S]*?)(<\/v>)?$/);
      out.push({ speaker: v ? v[1].trim() : '', startSec: toSec(m[1]), endSec: toSec(m[2]), text: (v ? v[2] : body).replace(/<[^>]+>/g, '').trim() });
    }
    return out;
  }
  const out: RawSegment[] = [];
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l) continue;
    let m = l.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]{1,80}):\s*(.+)$/);
    if (m) {
      out.push({ startSec: toSec(m[1]), speaker: m[2].trim(), text: m[3].trim() });
      continue;
    }
    m = l.match(/^([^:(]{1,80})\s*\((\d{1,2}:\d{2}(?::\d{2})?)\):\s*(.+)$/);
    if (m) {
      out.push({ speaker: m[1].trim(), startSec: toSec(m[2]), text: m[3].trim() });
      continue;
    }
    // Continuation of the previous speaker's turn.
    if (out.length) out[out.length - 1].text += ` ${l}`;
  }
  return out;
}

export function identifySpeakers(
  segs: RawSegment[],
  ctx: { candidateName?: string; interviewerNames: string[]; speakerMap?: Record<string, 'CANDIDATE' | 'INTERVIEWER'> },
  startSeq = 0,
): NormalisedSegment[] {
  const lc = (s: string) => s.trim().toLowerCase();
  const cand = ctx.candidateName ? lc(ctx.candidateName) : null;
  const interviewers = ctx.interviewerNames.map(lc);
  const classify = (raw: string): NormalisedSegment['speaker'] => {
    const mapped = ctx.speakerMap?.[raw] ?? ctx.speakerMap?.[lc(raw)];
    if (mapped === 'CANDIDATE') return 'CANDIDATE';
    if (mapped === 'INTERVIEWER') return `INTERVIEWER: ${raw}`;
    const r = lc(raw);
    if (r === 'candidate' || (cand && (r === cand || cand.split(/\s+/)[0] === r))) return 'CANDIDATE';
    if (r.startsWith('interviewer') || interviewers.some((n) => n === r || n.split(/\s+/)[0] === r)) return `INTERVIEWER: ${raw}`;
    return 'UNKNOWN';
  };
  return segs
    .filter((s) => s.text && s.text.trim())
    .map((s, i, arr) => {
      const start = Math.max(0, Math.floor(s.startSec || 0));
      const next = arr[i + 1]?.startSec;
      return {
        seq: startSeq + i,
        speaker: classify(s.speaker),
        startSec: start,
        endSec: Math.max(start, Math.floor(s.endSec ?? (next != null ? next : start + 5))),
        text: s.text.replace(/\s+/g, ' ').trim().slice(0, 8000),
      };
    });
}

export const fmtTs = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
};

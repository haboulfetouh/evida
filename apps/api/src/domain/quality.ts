/** Interview-quality metrics computed from transcript segments (pure; unit-tested). */
export interface QSeg {
  speaker: string;
  startSec: number;
  endSec: number;
  text: string;
}

export function talkMetrics(segs: QSeg[]) {
  const dur = (s: QSeg) => Math.max(1, s.endSec - s.startSec);
  const isCand = (s: QSeg) => s.speaker === 'CANDIDATE';
  const isIntv = (s: QSeg) => s.speaker.startsWith('INTERVIEWER');
  const cand = segs.filter(isCand).reduce((a, s) => a + dur(s), 0);
  const intv = segs.filter(isIntv).reduce((a, s) => a + dur(s), 0);
  const total = cand + intv || 1;
  const questions = segs.filter((s) => isIntv(s) && /\?\s*$|\?\s/.test(s.text));
  let interruptions = 0;
  for (let i = 1; i < segs.length; i++) {
    const prev = segs[i - 1];
    const cur = segs[i];
    if (prev.speaker !== cur.speaker && cur.startSec < prev.endSec - 1) interruptions++;
  }
  // A follow-up is an interviewer question that directly follows a candidate answer within the same topic window (< 90s).
  let followUps = 0;
  for (let i = 2; i < segs.length; i++) {
    if (isIntv(segs[i]) && /\?/.test(segs[i].text) && isCand(segs[i - 1]) && isIntv(segs[i - 2]) && /\?/.test(segs[i - 2].text) && segs[i].startSec - segs[i - 2].startSec < 90) followUps++;
  }
  return {
    candidateTalkPct: Math.round((cand / total) * 100),
    interviewerTalkPct: Math.round((intv / total) * 100),
    questions: questions.length,
    followUps,
    interruptions,
    durationSec: segs.length ? Math.max(...segs.map((s) => s.endSec)) - Math.min(...segs.map((s) => s.startSec)) : 0,
  };
}

/** Coaching hints, phrased as development suggestions — never as a performance rating. */
export function coachingHints(m: { coverage: number; candidateTalkPct: number; feedbackCompletion: number; evidenceQuality: number; followUpsPerInterview: number }) {
  const hints: string[] = [];
  if (m.coverage < 0.7) hints.push('Plan time for every competency in the stage; some areas finish without enough evidence.');
  if (m.candidateTalkPct < 60) hints.push('Give candidates more room to answer — aim for them to speak about two-thirds of the time.');
  if (m.followUpsPerInterview < 3) hints.push('Spend more time probing behavioral examples with follow-up questions (what did you do, what was the result).');
  if (m.evidenceQuality < 0.7) hints.push('Review AI-detected evidence during or right after the interview so scores rest on validated evidence.');
  if (m.feedbackCompletion < 0.9) hints.push('Submit scorecards within 24 hours while the interview is fresh.');
  return hints.length ? hints : ['Keep it up — your interviews are structured, evidence-rich and timely.'];
}

/** Escapes CSV and neutralises spreadsheet formula injection. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    let s = v == null ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}

import { describe, expect, it } from 'vitest';
import { identifySpeakers, parseTranscript, fmtTs } from '../../src/domain/transcript';
import { consentState } from '../../src/domain/consent';
import { talkMetrics, toCsv, coachingHints } from '../../src/domain/quality';

describe('transcript parsing & speaker identification', () => {
  it('parses bracketed timestamp lines with continuations', () => {
    const r = parseTranscript('[00:01:05] Karim: Tell me about your team?\n[00:01:10] Nour Example: I led 35 engineers.\nWe shipped weekly.');
    expect(r).toEqual([
      { startSec: 65, speaker: 'Karim', text: 'Tell me about your team?' },
      { startSec: 70, speaker: 'Nour Example', text: 'I led 35 engineers. We shipped weekly.' },
    ]);
  });

  it('parses WebVTT voice tags', () => {
    const r = parseTranscript('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Candidate>I own delivery.</v>\n\n00:00:05.000 --> 00:00:07.500\n<v Karim>Why?</v>');
    expect(r).toEqual([
      { speaker: 'Candidate', startSec: 1, endSec: 4, text: 'I own delivery.' },
      { speaker: 'Karim', startSec: 5, endSec: 7, text: 'Why?' },
    ]);
  });

  it('parses JSON segments', () => {
    expect(parseTranscript('[{"speaker":"A","start":3,"text":"hi"}]')).toEqual([{ speaker: 'A', startSec: 3, endSec: undefined, text: 'hi' }]);
  });

  it('maps speakers to CANDIDATE / INTERVIEWER and leaves unknown voices out of evidence', () => {
    const segs = identifySpeakers(
      [
        { speaker: 'Karim', startSec: 0, text: 'Q?' },
        { speaker: 'Nour', startSec: 5, text: 'Answer' },
        { speaker: 'Guest', startSec: 9, text: 'noise' },
        { speaker: 'Spk1', startSec: 12, text: 'mapped' },
      ],
      { candidateName: 'Nour Example', interviewerNames: ['Karim Interviewer'], speakerMap: { Spk1: 'CANDIDATE' } },
      10,
    );
    expect(segs.map((s) => [s.seq, s.speaker, s.endSec])).toEqual([
      [10, 'INTERVIEWER: Karim', 5],
      [11, 'CANDIDATE', 9],
      [12, 'UNKNOWN', 12],
      [13, 'CANDIDATE', 17],
    ]);
  });

  it('formats timestamps', () => expect(fmtTs(1634)).toBe('00:27:14'));
});

describe('consent state', () => {
  it('uses the latest decision per type and honours withdrawal', () => {
    const t = (m: number) => new Date(2026, 0, 1, 0, m);
    const s = consentState([
      { type: 'AI_ANALYSIS', granted: false, withdrawnAt: null, grantedAt: t(1) },
      { type: 'AI_ANALYSIS', granted: true, withdrawnAt: null, grantedAt: t(2) },
      { type: 'RECORDING', granted: true, withdrawnAt: t(5), grantedAt: t(1) },
    ]);
    expect(s).toEqual({ AI_ANALYSIS: 'GRANTED', RECORDING: 'WITHDRAWN', TRANSCRIPTION: 'PENDING', PROFILING: 'PENDING' });
  });
});

describe('interview quality', () => {
  it('computes talk ratio, questions, follow-ups and interruptions', () => {
    const m = talkMetrics([
      { speaker: 'INTERVIEWER: A', startSec: 0, endSec: 10, text: 'Tell me about a delivery?' },
      { speaker: 'CANDIDATE', startSec: 10, endSec: 70, text: 'We shipped...' },
      { speaker: 'INTERVIEWER: A', startSec: 65, endSec: 75, text: 'What was the result?' },
      { speaker: 'CANDIDATE', startSec: 75, endSec: 105, text: 'It doubled.' },
    ]);
    expect(m).toMatchObject({ candidateTalkPct: 82, questions: 2, followUps: 1, interruptions: 1 });
  });

  it('phrases coaching as development suggestions', () => {
    expect(coachingHints({ coverage: 0.5, candidateTalkPct: 50, feedbackCompletion: 1, evidenceQuality: 1, followUpsPerInterview: 4 })).toHaveLength(2);
  });

  it('neutralises CSV formula injection', () => {
    expect(toCsv([{ a: '=HYPERLINK("x")', b: 'x,y' }])).toBe('a,b\n"\'=HYPERLINK(""x"")","x,y"');
  });
});

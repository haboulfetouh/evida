'use client';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Subscribes to the interview's Server-Sent Events and refreshes the affected queries. */
export function useInterviewStream(interviewId: string, onEvent?: (type: string, data: any) => void) {
  const qc = useQueryClient();
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    const es = new EventSource(`/api/v1/interviews/${interviewId}/stream`, { withCredentials: true });
    const handle = (type: string) => (e: MessageEvent) => {
      const data = JSON.parse(e.data || '{}');
      if (type === 'evidence.updated' || type === 'coverage.updated') {
        qc.invalidateQueries({ queryKey: ['evidence', interviewId] });
        qc.invalidateQueries({ queryKey: ['coverage', interviewId] });
      }
      if (type === 'ai.status') qc.invalidateQueries({ queryKey: ['interview', interviewId] });
      cb.current?.(type, data);
    };
    for (const t of ['evidence.updated', 'coverage.updated', 'ai.status', 'transcript.appended', 'copilot.suggestions']) es.addEventListener(t, handle(t) as EventListener);
    return () => es.close();
  }, [interviewId, qc]);
}

/**
 * Browser speech recognition of the local microphone only, so each participant's words are
 * attributed to them exactly. Opt-in: browsers may send audio to their vendor's speech service.
 */
export function useCaptions(enabled: boolean, lang: string, onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const cb = useRef(onFinal);
  cb.current = onFinal;
  useEffect(() => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    setSupported(Boolean(SR));
    if (!SR || !enabled) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = lang === 'ar' ? 'ar-EG' : 'en-US';
    let stop = false;
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) cb.current(e.results[i][0].transcript.trim());
    };
    rec.onend = () => { if (!stop) try { rec.start(); } catch { /* already started */ } };
    rec.onstart = () => setActive(true);
    try { rec.start(); } catch { /* ignore */ }
    return () => { stop = true; setActive(false); rec.stop(); };
  }, [enabled, lang]);
  return { supported, active };
}

export const captionsFeature = process.env.NEXT_PUBLIC_BROWSER_CAPTIONS === 'true';

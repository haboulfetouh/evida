'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from './ui';

/** Camera, microphone and browser checks before joining. Media never leaves the device. */
export function DeviceCheck() {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<{ camera?: boolean; mic?: boolean; level: number }>({ level: 0 });
  const [browserOk, setBrowserOk] = useState(true);
  const stream = useRef<MediaStream | null>(null);
  useEffect(() => {
    setBrowserOk(typeof navigator.mediaDevices?.getUserMedia === 'function' && 'RTCPeerConnection' in window);
    return () => stream.current?.getTracks().forEach((tr) => tr.stop());
  }, []);
  const run = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.current = s;
      if (video.current) video.current.srcObject = s;
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteFrequencyData(buf);
        const level = Math.min(1, buf.reduce((a, v) => a + v, 0) / buf.length / 60);
        setState((x) => ({ ...x, level }));
        if (stream.current) requestAnimationFrame(tick);
      };
      setState({ camera: s.getVideoTracks().length > 0, mic: s.getAudioTracks().length > 0, level: 0 });
      tick();
    } catch {
      setState({ camera: false, mic: false, level: 0 });
    }
  };
  const Row = ({ label, ok }: { label: string; ok?: boolean }) => (
    <li className="flex items-center justify-between text-sm">
      <span>{label}</span>
      {ok === undefined ? <span className="text-muted">—</span> : ok ? <span className="inline-flex items-center gap-1 text-valid"><Check className="h-4 w-4" />{t('portal.ok')}</span> : <span className="inline-flex items-center gap-1 text-gap"><X className="h-4 w-4" />{t('portal.fail')}</span>}
    </li>
  );
  return (
    <div className="space-y-3">
      <video ref={video} autoPlay muted playsInline className="aspect-video w-full rounded bg-ink/10 object-cover" />
      <div className="h-1.5 overflow-hidden rounded bg-ink/10" aria-hidden><div className="h-full bg-valid transition-[width]" style={{ width: `${Math.round(state.level * 100)}%` }} /></div>
      <ul className="space-y-1.5">
        <Row label={t('portal.browser')} ok={browserOk} />
        <Row label={t('portal.camera')} ok={state.camera} />
        <Row label={t('portal.microphone')} ok={state.mic} />
      </ul>
      <Button size="sm" onClick={run}>{t('portal.testDevices')}</Button>
    </div>
  );
}

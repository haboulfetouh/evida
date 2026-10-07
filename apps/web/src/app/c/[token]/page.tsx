'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Captions } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { captionsFeature, useCaptions } from '@/lib/live';
import { Logo } from '@/components/logo';
import { DeviceCheck } from '@/components/device-check';
import { JitsiFrame } from '@/components/jitsi-frame';
import { Badge, Button, cx, ErrorNote, Loading, Section, Textarea } from '@/components/ui';

type Step = 'info' | 'room' | 'feedback';

/** Candidate experience: no scores, no AI output, nothing about other candidates. */
export default function Portal() {
  const { token } = useParams<{ token: string }>();
  const { t, locale, setLocale } = useI18n();
  const call = <T,>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => api<T>(`/portal${path}`, { method, body, candidateToken: token });
  const info = useQuery({ queryKey: ['portal', token], queryFn: () => call<any>(''), retry: false });
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState<Step>('info');
  const [room, setRoom] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [fb, setFb] = useState<{ rating: number; structured?: boolean; understood?: boolean; respected?: boolean; clear?: boolean; comment: string }>({ rating: 0, comment: '' });
  const [fbDone, setFbDone] = useState(false);
  const [captions, setCaptions] = useState(false);
  const pending = useRef<{ text: string; at: number }[]>([]);
  const { supported: capSupported } = useCaptions(captions && step === 'room', locale, (text) => pending.current.push({ text, at: Date.now() }));

  useEffect(() => {
    if (!info.data) return;
    const c = info.data.consent;
    setChoices(Object.fromEntries(info.data.policy.required.map((k: string) => [k, c[k] === 'GRANTED'])));
    if (info.data.status === 'COMPLETED') setStep('feedback');
    if (info.data.locale && !document.cookie.includes('evida_locale=')) setLocale(info.data.locale);
  }, [info.data, setLocale]);
  useEffect(() => {
    if (!captions || step !== 'room') return;
    const i = setInterval(async () => {
      const batch = pending.current.splice(0);
      if (!batch.length) return;
      const now = Date.now();
      await call('/transcript', 'POST', { segments: batch.map((b) => ({ offsetMs: Math.min(60_000, now - b.at), text: b.text })) }).catch(() => undefined);
    }, 4000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captions, step]);

  if (info.isLoading) return <div className="p-8"><Loading /></div>;
  if (info.error) return (
    <div className="mx-auto max-w-lg px-6 py-16"><Logo /><p className="mt-8 text-lg">{(info.error as ApiError).status === 401 ? t('portal.invalid') : t('error.generic')}</p></div>
  );
  const x = info.data;
  const consentSaved = Object.values(x.consent).some((v) => v !== 'PENDING');

  const saveConsent = async () => {
    setBusy(true); setError(null);
    try {
      await call('/consent', 'POST', { version: x.policy.version, decisions: Object.entries(choices).map(([type, granted]) => ({ type, granted })) });
      await info.refetch();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const join = async () => {
    setBusy(true); setError(null);
    try { setRoom(await call('/room')); setStep('room'); } catch (e) { setError(e); } finally { setBusy(false); }
  };

  const header = (
    <header className="flex items-center justify-between bg-brand px-6 py-3 text-white dark:bg-surface dark:text-ink">
      <span className="flex items-center gap-3"><Logo inverse /><span className="hidden text-sm text-white/80 sm:inline">{x.organization}</span></span>
      <button className="text-sm text-white/85 hover:text-white" onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}>{t('nav.language')}</button>
    </header>
  );

  if (step === 'room' && room) return (
    <div className="flex h-screen flex-col">
      {header}
      <div className="flex flex-wrap items-center gap-3 px-6 py-2 text-sm">
        <span className="font-medium">{x.jobTitle} — {x.stage}</span>
        <Badge tone={room.recordingActive ? 'gap' : 'neutral'}>{room.recordingActive ? t('room.recordingOn') : t('room.recordingOff')}</Badge>
        {captionsFeature && capSupported && x.consent.TRANSCRIPTION === 'GRANTED' && (
          <Button size="sm" variant={captions ? 'primary' : 'secondary'} aria-pressed={captions} title={t('room.captionsHint')} onClick={() => setCaptions(!captions)}><Captions className="h-4 w-4" />{t('room.captions')}</Button>
        )}
        <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setStep('feedback')}>{t('portal.leave')}</Button>
      </div>
      <div className="flex-1 px-6 pb-6"><JitsiFrame domain={room.jitsi.domain} roomName={room.jitsi.roomName} jwt={room.jitsi.jwt} displayName={x.candidateName} onLeave={() => setStep('feedback')} toolbar={['microphone', 'camera', 'desktop', 'fullscreen', 'tileview', 'hangup']} /></div>
    </div>
  );

  if (step === 'feedback') return (
    <div className="min-h-screen">
      {header}
      <main className="mx-auto max-w-xl px-6 py-10">
        {fbDone || x.feedbackSubmitted ? <p className="text-lg">{t('portal.fb.thanks')}</p> : (
          <form className="space-y-6" onSubmit={async (e) => {
            e.preventDefault(); setError(null);
            try { await call('/feedback', 'POST', fb); setFbDone(true); } catch (err) { setError(err); }
          }}>
            <h1 className="text-2xl font-semibold">{t('portal.feedbackTitle')}</h1>
            <div className="flex gap-2" role="radiogroup" aria-label={t('portal.feedbackTitle')}>
              {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={fb.rating === n} onClick={() => setFb({ ...fb, rating: n })} className={cx('tnum h-12 w-12 rounded border text-lg', fb.rating >= n ? 'border-brand bg-brand-soft text-brand' : 'border-line')}>{n}</button>)}
            </div>
            {(['structured', 'understood', 'respected', 'clear'] as const).map((k) => (
              <fieldset key={k} className="flex flex-wrap items-center justify-between gap-3">
                <legend className="sr-only">{t(`portal.fb.${k}` as MessageKey)}</legend>
                <span>{t(`portal.fb.${k}` as MessageKey)}</span>
                <span className="flex gap-2">
                  {[true, false].map((v) => <button key={String(v)} type="button" aria-pressed={fb[k] === v} onClick={() => setFb({ ...fb, [k]: v })} className={cx('rounded border px-3 py-1.5 text-sm', fb[k] === v ? 'border-brand bg-brand-soft text-brand' : 'border-line')}>{v ? t('portal.yes') : t('portal.no')}</button>)}
                </span>
              </fieldset>
            ))}
            <Textarea aria-label={t('portal.fb.comment')} placeholder={t('portal.fb.comment')} value={fb.comment} onChange={(e) => setFb({ ...fb, comment: e.target.value })} />
            {error ? <ErrorNote error={error} /> : null}
            <Button type="submit" variant="primary" disabled={!fb.rating}>{t('portal.fb.submit')}</Button>
          </form>
        )}
      </main>
    </div>
  );

  return (
    <div className="min-h-screen">
      {header}
      <main className="mx-auto grid max-w-5xl gap-6 px-6 py-8 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <div>
            <p className="text-sm text-muted">{t('portal.welcome')}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{x.jobTitle}</h1>
            <p className="tnum mt-2 text-lg">{fmtDate(x.scheduledAt, locale, { dateStyle: 'full', timeStyle: 'short' })} — {x.durationMinutes} {t('common.minutes')}</p>
            <p className="mt-1 text-muted">{t('portal.with')}: {x.interviewers.join(', ')}</p>
          </div>
          <Section title={t('portal.stages')}>
            <ol className="space-y-2">
              {x.stages.map((s: any, i: number) => (
                <li key={i} className={cx('flex items-center justify-between rounded px-3 py-2 text-sm', s.current ? 'bg-brand-soft font-medium text-brand' : 'text-muted')}>
                  <span><span className="tnum me-2">{i + 1}.</span>{s.name}{s.current && ` — ${t('portal.current')}`}</span><span className="tnum">{s.durationMinutes} {t('common.minutes')}</span>
                </li>
              ))}
            </ol>
          </Section>
          <Section title={t('portal.aiDisclosure')}>
            <p className="text-sm leading-6">{t('portal.aiText')}</p>
            <p className="mt-2 text-xs text-muted">{t('gov.location')}: {x.policy.processingLocation} — {t('portal.policyVersion')} {x.policy.version}</p>
          </Section>
          <Section title={t('portal.consentTitle')} description={t('portal.consentHelp')}>
            {x.policy.recording && <p className="mb-3 text-sm">{t('portal.recordingNotice')}</p>}
            <ul className="space-y-3">
              {x.policy.required.map((k: string) => (
                <li key={k} className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm font-medium">{t(`consent.${k}` as MessageKey)} <Badge className="ms-1" tone={x.consent[k] === 'GRANTED' ? 'valid' : x.consent[k] === 'PENDING' ? 'neutral' : 'gap'}>{t(`consent.${x.consent[k]}` as MessageKey)}</Badge></span>
                  <span className="flex gap-2">
                    {[true, false].map((v) => <button key={String(v)} type="button" aria-pressed={choices[k] === v} onClick={() => setChoices({ ...choices, [k]: v })} className={cx('rounded border px-3 py-1.5 text-sm', choices[k] === v ? (v ? 'border-valid bg-valid-soft text-valid' : 'border-gap bg-gap-soft text-gap') : 'border-line')}>{v ? t('portal.yes') : t('portal.no')}</button>)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" loading={busy} onClick={saveConsent}>{t('portal.consentSave')}</Button>
              {Object.entries(x.consent).filter(([, v]) => v === 'GRANTED').map(([k]) => (
                <Button key={k} size="sm" variant="ghost" onClick={async () => { await call('/consent/withdraw', 'POST', { type: k }); info.refetch(); }}>{t('portal.withdraw')}: {t(`consent.${k}` as MessageKey)}</Button>
              ))}
            </div>
          </Section>
        </div>
        <div className="space-y-6">
          <Section title={t('portal.tech')}><DeviceCheck /></Section>
          {error ? <ErrorNote error={(error as ApiError).code === 'TOO_EARLY' ? new ApiError(409, 'TOO_EARLY', t('portal.tooEarly')) : error} /> : null}
          <Button variant="primary" className="h-12 w-full text-base" disabled={!consentSaved || x.status === 'CANCELLED'} loading={busy} onClick={join}>{t('portal.join')}</Button>
          {x.status === 'CANCELLED' && <p className="text-sm text-gap">{t('portal.closed')}</p>}
        </div>
      </main>
    </div>
  );
}

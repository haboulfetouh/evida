'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Captions, ChevronLeft, ChevronRight, Circle, Lightbulb, Sparkles } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { get, post } from '@/lib/api';
import { useMe } from '@/lib/session';
import { aiTone } from '@/lib/format';
import { captionsFeature, useCaptions, useInterviewStream } from '@/lib/live';
import { JitsiFrame } from '@/components/jitsi-frame';
import { CoverageList } from '@/components/evidence-meter';
import { AddEvidence, EvidenceList } from '@/components/evidence-list';
import { Badge, Button, cx, ErrorNote, Loading, Tabs, Textarea } from '@/components/ui';

type Tab = 'guide' | 'evidence' | 'notes';

function useElapsed(since: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  if (!since) return '00:00';
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].filter((v, i) => i > 0 || v > 0).map((v) => String(v).padStart(2, '0')).join(':');
}

export default function Room() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const router = useRouter();
  const { data: me } = useMe();
  const iv = useQuery({ queryKey: ['interview', id], queryFn: () => get(`/interviews/${id}`) });
  const room = useQuery({ queryKey: ['room', id], queryFn: () => get(`/interviews/${id}/room`), staleTime: Infinity, retry: false });
  const coverage = useQuery({ queryKey: ['coverage', id], queryFn: () => get(`/interviews/${id}/coverage`) });
  const evidence = useQuery({ queryKey: ['evidence', id], queryFn: () => get<any[]>(`/interviews/${id}/evidence`) });
  const notes = useQuery({ queryKey: ['notes', id], queryFn: () => get<any[]>(`/interviews/${id}/notes`) });
  useInterviewStream(id);

  const [tab, setTab] = useState<Tab>('guide');
  const [qi, setQi] = useState(0);
  const [asked, setAsked] = useState<string[]>([]);
  const [copilot, setCopilot] = useState<any[] | null>(null);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [captions, setCaptions] = useState(false);
  const elapsed = useElapsed(iv.data?.startedAt ?? null);
  const pending = useRef<{ text: string; at: number }[]>([]);

  const questions = useMemo(() => (iv.data?.guide.competencies ?? []).flatMap((c: any) => c.questions.map((q: any) => ({ ...q, competency: c }))), [iv.data]);
  const inProgress = iv.data?.status === 'IN_PROGRESS';
  const { supported: capSupported, active: capActive } = useCaptions(captions && inProgress, locale, (text) => pending.current.push({ text, at: Date.now() }));
  useEffect(() => {
    if (!captions || !inProgress || !iv.data?.startedAt) return;
    const flush = setInterval(async () => {
      const batch = pending.current.splice(0);
      if (!batch.length || !me) return;
      const base = new Date(iv.data.startedAt).getTime();
      await post(`/interviews/${id}/transcript/segments`, { segments: batch.map((b) => ({ speaker: me.name, startSec: Math.max(0, Math.floor((b.at - base) / 1000)), text: b.text })) }).catch(setError);
    }, 4000);
    return () => clearInterval(flush);
  }, [captions, inProgress, iv.data?.startedAt, id, me]);

  if (iv.isLoading || room.isLoading) return <Loading />;
  if (iv.error || room.error) return <ErrorNote error={iv.error ?? room.error} />;
  const x = iv.data;
  const r = room.data;
  const q = questions[qi];
  const comps = x.guide.competencies.map((c: any) => ({ id: c.id, name: c.name }));
  const refreshEvidence = () => { evidence.refetch(); coverage.refetch(); };

  const askCopilot = async () => {
    setCopilotBusy(true); setError(null);
    try { const res = await post(`/interviews/${id}/copilot`, { askedQuestionIds: asked }); setCopilot(res.suggestions); } catch (e) { setError(e); } finally { setCopilotBusy(false); }
  };

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100vh-56px)] flex-col md:-mx-8 md:-my-8">
      {/* Control zone */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2.5 md:px-6">
        <Link href={`/interviews/${id}`} className="text-sm text-muted hover:text-ink" aria-label={t('common.back')}><ChevronLeft className="h-4 w-4 rtl:rotate-180" /></Link>
        <div className="min-w-0">
          <div className="truncate font-semibold">{x.candidate.name} <span className="font-normal text-muted">— {x.job.title}, {x.guide.stage.name}</span></div>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2 text-sm">
          <span className="tnum rounded bg-ink/[0.05] px-2 py-1" aria-label={t('room.timer')}>{elapsed}</span>
          <Badge tone={r.recordingAllowed ? 'gap' : 'neutral'}><Circle className={cx('h-2.5 w-2.5', r.recordingAllowed && 'fill-current')} />{r.recordingAllowed ? t('room.recordingOn') : t('room.recordingOff')}</Badge>
          <Badge tone={r.aiAllowed ? 'brand' : 'neutral'}>{t('consent.AI_ANALYSIS')}: {t(`consent.${r.consent.AI_ANALYSIS}` as MessageKey)}</Badge>
          <Badge tone={aiTone(x.aiStatus)}>{t(`iv.ai.${x.aiStatus}` as MessageKey)}</Badge>
          {captionsFeature && capSupported && r.consent.TRANSCRIPTION === 'GRANTED' && (
            <Button size="sm" variant={captions ? 'primary' : 'secondary'} aria-pressed={captions} title={t('room.captionsHint')} onClick={() => setCaptions((c) => !c)} disabled={!inProgress}>
              <Captions className="h-4 w-4" />{t('room.captions')}{capActive && ' ●'}
            </Button>
          )}
          {x.status === 'SCHEDULED' && <Button size="sm" variant="primary" onClick={async () => { await post(`/interviews/${id}/start`); iv.refetch(); }}>{t('room.start')}</Button>}
          {x.status === 'IN_PROGRESS' && (
            <Button size="sm" variant="danger" onClick={async () => {
              if (!confirm(t('room.completeConfirm'))) return;
              await post(`/interviews/${id}/complete`);
              router.push(`/interviews/${id}/scorecard`);
            }}>{t('room.complete')}</Button>
          )}
        </div>
      </div>
      {error ? <div className="px-4 pt-3 md:px-6"><ErrorNote error={error} /></div> : null}

      <div className="grid flex-1 gap-0 lg:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]">
        {/* Video zone */}
        <div className="flex min-h-[360px] flex-col gap-4 p-4 md:p-6">
          <div className="min-h-[320px] flex-1">
            <JitsiFrame domain={r.jitsi.domain} roomName={r.jitsi.roomName} jwt={r.jitsi.jwt} displayName={me?.name ?? ''} onLeave={() => router.push(`/interviews/${id}`)} />
          </div>
          <div className="rounded-md border border-line bg-surface px-4 py-3">
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">{t('room.coverage')}</h2>
              {coverage.data && <span className="tnum text-sm text-muted">{Math.round(coverage.data.overall * 100)}%</span>}
            </div>
            {coverage.data && (
              <>
                <CoverageList rows={coverage.data.competencies} compact twoColumn />
                <p className={cx('mt-2 text-sm', coverage.data.missing.length ? 'text-gap' : 'text-valid')}>
                  {coverage.data.missing.length ? `${t('room.missing')}: ${coverage.data.missing.join(', ')}` : t('room.sufficient')}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Interview intelligence zone */}
        <aside className="flex min-h-0 flex-col border-line bg-surface lg:border-s">
          <div className="px-4 pt-2"><Tabs<Tab> value={tab} onChange={setTab} items={[{ value: 'guide', label: t('room.tab.guide') }, { value: 'evidence', label: `${t('room.tab.evidence')} (${evidence.data?.filter((e) => e.status !== 'REJECTED').length ?? 0})` }, { value: 'notes', label: t('room.tab.notes') }]} /></div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {tab === 'guide' && (
              <div className="space-y-6">
                {q ? (
                  <div>
                    <div className="flex items-center justify-between text-sm text-muted">
                      <span>{q.competency.name}</span>
                      <span className="tnum">{t('room.question')} {qi + 1} {t('room.of')} {questions.length}</span>
                    </div>
                    <p className="mt-2 text-lg font-medium leading-snug">{q.text}</p>
                    {q.followUps.length > 0 && (
                      <div className="mt-3">
                        <p className="text-sm text-muted">{t('room.followUps')}</p>
                        <ul className="mt-1 list-disc space-y-1 ps-5 text-sm">{q.followUps.map((f: string, i: number) => <li key={i}>{f}</li>)}</ul>
                      </div>
                    )}
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="ghost" disabled={qi === 0} onClick={() => setQi(qi - 1)}><ChevronLeft className="h-4 w-4 rtl:rotate-180" />{t('room.prev')}</Button>
                      <Button size="sm" variant={asked.includes(q.id) ? 'primary' : 'secondary'} aria-pressed={asked.includes(q.id)} onClick={() => setAsked(asked.includes(q.id) ? asked.filter((a) => a !== q.id) : [...asked, q.id])}>{asked.includes(q.id) ? t('room.asked') : t('room.markAsked')}</Button>
                      <Button size="sm" variant="ghost" disabled={qi >= questions.length - 1} onClick={() => setQi(qi + 1)}>{t('room.next')}<ChevronRight className="h-4 w-4 rtl:rotate-180" /></Button>
                    </div>
                    <div className="mt-4 flex gap-1" aria-hidden>{questions.map((qq: any, i: number) => <span key={qq.id} className={cx('h-1 flex-1 rounded-full', asked.includes(qq.id) ? 'bg-brand' : i === qi ? 'bg-ink/40' : 'bg-ink/10')} />)}</div>
                  </div>
                ) : <p className="text-sm text-muted">{t('common.none')}</p>}

                <div className="border-t border-line pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Lightbulb className="h-4 w-4" aria-hidden />{t('room.copilot')}</h3>
                    {r.liveCopilot && <Button size="sm" loading={copilotBusy} onClick={askCopilot}><Sparkles className="h-4 w-4" />{t('room.askCopilot')}</Button>}
                  </div>
                  {!r.aiAllowed ? <p className="mt-2 text-sm text-muted">{t('room.noAi')}</p> : (
                    <>
                      <p className="mt-1 text-xs text-muted">{t('room.copilotNote')}</p>
                      {copilot && (
                        <ul className="mt-3 space-y-2">
                          {copilot.map((s, i) => (
                            <li key={i} className="rounded border border-pending/40 bg-pending-soft/40 px-3 py-2 text-sm">
                              <p className="font-medium">{s.question}</p>
                              <p className="mt-0.5 text-xs text-muted">{x.guide.competencies.find((c: any) => c.key === s.competencyKey)?.name} — {s.reason}</p>
                            </li>
                          ))}
                          {!copilot.length && <li className="text-sm text-valid">{t('room.sufficient')}</li>}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            {tab === 'evidence' && (
              <div className="space-y-6">
                <EvidenceList items={[...(evidence.data ?? [])].reverse()} competencies={comps} canValidate onChanged={refreshEvidence} />
                <details className="border-t border-line pt-4">
                  <summary className="cursor-pointer text-sm font-semibold">{t('room.addEvidence')}</summary>
                  <div className="mt-3"><AddEvidence interviewId={id} competencies={comps} onDone={refreshEvidence} /></div>
                </details>
              </div>
            )}
            {tab === 'notes' && (
              <div className="space-y-4">
                <form onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await post(`/interviews/${id}/notes`, { body: note }); setNote(''); notes.refetch(); }} className="space-y-2">
                  <Textarea aria-label={t('room.notes')} placeholder={t('room.notesPlaceholder')} rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
                  <Button size="sm" type="submit">{t('common.save')}</Button>
                </form>
                <ul className="space-y-3">
                  {notes.data?.slice().reverse().map((n) => <li key={n.id} className="whitespace-pre-line border-s-2 border-line ps-3 text-sm">{n.body}</li>)}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

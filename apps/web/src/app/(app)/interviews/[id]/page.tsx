'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Video } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { get, patch, post } from '@/lib/api';
import { useCan } from '@/lib/session';
import { aiTone, fmtDate } from '@/lib/format';
import { CoverageList } from '@/components/evidence-meter';
import { DeviceCheck } from '@/components/device-check';
import { Badge, Button, ErrorNote, Field, Input, Loading, Modal, PageHeader, Section, Textarea, Toggle } from '@/components/ui';

function InterviewPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const can = useCan();
  const justScheduled = useSearchParams().get('scheduled') === '1';
  const q = useQuery({ queryKey: ['interview', id], queryFn: () => get(`/interviews/${id}`) });
  const recs = useQuery({ queryKey: ['recordings', id], queryFn: () => get<any[]>(`/interviews/${id}/recordings`), enabled: can('recording.access') && q.data?.recordingEnabled });
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(justScheduled ? t('iv.scheduled') : null);
  const [upload, setUpload] = useState(false);
  const [content, setContent] = useState('');
  const [replace, setReplace] = useState(false);
  const [resched, setResched] = useState(false);
  const [when, setWhen] = useState('');
  const act = async (fn: () => Promise<unknown>, msg?: string) => {
    setError(null);
    try { await fn(); await q.refetch(); if (msg) setNotice(msg); } catch (e) { setError(e); }
  };
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const iv = q.data;
  const active = iv.status === 'SCHEDULED' || iv.status === 'IN_PROGRESS';

  return (
    <>
      <PageHeader
        back={<Link href="/interviews" className="mb-2 inline-block text-sm text-muted hover:text-ink">{t('iv.title')}</Link>}
        title={`${iv.candidate.name} — ${iv.guide.stage.name}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span>{iv.job.title}</span><span className="tnum">{fmtDate(iv.scheduledAt, locale)}, {iv.durationMinutes} {t('common.minutes')}</span>
          <Badge tone={iv.status === 'IN_PROGRESS' ? 'brand' : iv.status === 'CANCELLED' ? 'gap' : 'neutral'}>{t(`iv.status.${iv.status}` as MessageKey)}</Badge>
          <Badge tone={aiTone(iv.aiStatus)}>{t(`iv.ai.${iv.aiStatus}` as MessageKey)}</Badge>
          {iv.candidate.isSynthetic && <Badge tone="pending">{t('common.synthetic')}</Badge>}</span>}
        actions={
          <>
            {iv.isParticipant && active && <Link href={`/interviews/${id}/room`}><Button variant="primary"><Video className="h-4 w-4" />{t('iv.enterRoom')}</Button></Link>}
            {iv.isParticipant && can('interview.score') && iv.status !== 'CANCELLED' && <Link href={`/interviews/${id}/scorecard`}><Button><ClipboardCheck className="h-4 w-4" />{t('iv.openScorecard')}</Button></Link>}
            {can('decision.read') && <Link href={`/applications/${iv.applicationId}/decision`}><Button>{t('cand.decision')}</Button></Link>}
          </>
        }
      />
      {notice && <p className="mb-4 rounded border border-valid/30 bg-valid-soft px-4 py-2 text-sm text-valid" role="status">{notice}</p>}
      {error ? <div className="mb-4"><ErrorNote error={error} /></div> : null}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Section title={t('iv.guide')}>
          <ol className="space-y-5">
            {iv.guide.competencies.map((c: any) => (
              <li key={c.id}>
                <h3 className="font-semibold">{c.name}</h3>
                <p className="text-sm text-muted">{c.description}</p>
                <ul className="mt-2 space-y-2">
                  {c.questions.map((qq: any) => (
                    <li key={qq.id} className="text-sm">
                      <p>{qq.text}</p>
                      {qq.followUps.length > 0 && <p className="text-muted">{t('comp.followUps')}: {qq.followUps.join(' / ')}</p>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </Section>
        <div className="space-y-6">
          <Section title={t('room.coverage')}><CoverageList rows={iv.coverage.competencies} /></Section>
          <Section title={t('iv.panel')}>
            <ul className="space-y-1 text-sm">{iv.participants.map((p: any) => <li key={p.id}>{p.name}{p.isLead && <span className="text-muted"> — {t('iv.lead')}</span>}</li>)}</ul>
          </Section>
          <Section title={t('iv.consent')}>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {Object.entries(iv.consent).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted">{t(`consent.${k}` as MessageKey)}</dt><dd><Badge tone={v === 'GRANTED' ? 'valid' : v === 'PENDING' ? 'neutral' : 'gap'}>{t(`consent.${v}` as MessageKey)}</Badge></dd></div>
              ))}
            </dl>
          </Section>
          {iv.isParticipant && active && <Section title={t('iv.techCheck')}><DeviceCheck /></Section>}
          {(can('interview.create') || can('transcript.write')) && (
            <Section>
              <div className="flex flex-wrap gap-2">
                {can('transcript.write') && iv.status !== 'CANCELLED' && <Button size="sm" onClick={() => setUpload(true)}>{t('iv.uploadTranscript')}</Button>}
                {can('interview.create') && active && (
                  <>
                    <Button size="sm" onClick={() => act(() => post(`/interviews/${id}/invitation`), t('iv.scheduled'))}>{t('iv.resend')}</Button>
                    {iv.status === 'SCHEDULED' && <Button size="sm" onClick={() => setResched(true)}>{t('iv.reschedule')}</Button>}
                    <Button size="sm" variant="danger" onClick={() => confirm(t('iv.cancel') + '?') && act(() => post(`/interviews/${id}/cancel`))}>{t('iv.cancel')}</Button>
                  </>
                )}
              </div>
            </Section>
          )}
          {recs.data && recs.data.length > 0 && (
            <Section title={t('consent.RECORDING')}>
              <ul className="space-y-2 text-sm">
                {recs.data.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span className="tnum">{fmtDate(r.createdAt, locale)}</span>
                    <Button size="sm" onClick={async () => { const x = await get(`/interviews/${id}/recordings/${r.id}/download`); window.location.href = x.url; }}>{t('common.download')}</Button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
      <Modal open={upload} onClose={() => setUpload(false)} title={t('iv.uploadTranscript')} wide>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          await act(async () => { const r = await post(`/interviews/${id}/transcript`, { content, replace, language: locale }); setUpload(false); setContent(''); setNotice(`${r.appended} ${t('iv.transcriptAdded')}`); });
        }}>
          <Field label={t('iv.uploadTranscript')} hint={t('iv.transcriptHint')} htmlFor="tr"><Textarea id="tr" rows={12} required value={content} onChange={(e) => setContent(e.target.value)} className="font-mono text-sm" /></Field>
          <input type="file" accept=".vtt,.txt,.json" aria-label={t('iv.uploadTranscript')} className="text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setContent(await f.text()); }} />
          <Toggle id="rep" checked={replace} onChange={setReplace} label={t('iv.replaceTranscript')} />
          {error ? <ErrorNote error={error} /> : null}
          <Button type="submit" variant="primary">{t('iv.uploadTranscript')}</Button>
        </form>
      </Modal>
      <Modal open={resched} onClose={() => setResched(false)} title={t('iv.reschedule')}>
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); await act(() => patch(`/interviews/${id}/reschedule`, { scheduledAt: new Date(when).toISOString() })); setResched(false); }}>
          <Field label={t('iv.when')} htmlFor="w"><Input id="w" type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <Button type="submit" variant="primary">{t('iv.reschedule')}</Button>
        </form>
      </Modal>
    </>
  );
}
export default function Page() {
  return <Suspense><InterviewPage /></Suspense>;
}

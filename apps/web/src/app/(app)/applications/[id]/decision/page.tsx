'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Printer, RefreshCw } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { get, post, waitForJob } from '@/lib/api';
import { useCan } from '@/lib/session';
import { fmtDate, fmtNum } from '@/lib/format';
import { EvidenceProfile } from '@/components/evidence-profile';
import { Badge, Button, cx, Empty, ErrorNote, Field, Loading, PageHeader, Section, Textarea } from '@/components/ui';

const OUTCOMES = ['HIRE', 'OFFER', 'ADDITIONAL_INTERVIEW', 'HOLD', 'REJECT'];

export default function Decision() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const can = useCan();
  const q = useQuery({ queryKey: ['decision', id], queryFn: () => get(`/applications/${id}/decision`) });
  const [outcome, setOutcome] = useState('');
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const x = q.data;
  const s = x.summary;
  const evById = new Map(x.profile.competencies.flatMap((c: any) => [...c.validated, ...c.pending].map((e: any) => [e.id, { ...e, competency: c.name }])));
  const needsAck = x.unresolvedAreas.length > 0 && ['HIRE', 'OFFER', 'REJECT'].includes(outcome);
  const cites = (ids: string[]) => (
    <span className="ms-1 inline-flex flex-wrap gap-1 align-middle">
      {ids.map((eid) => {
        const e: any = evById.get(eid);
        return e ? <span key={eid} title={`“${e.quote}” — ${e.competency}`} className="cursor-help rounded-sm bg-ink/[0.06] px-1 text-xs text-muted">{e.competency}</span> : null;
      })}
    </span>
  );

  return (
    <>
      <PageHeader
        back={<Link href={`/candidates/${x.candidate.id}`} className="mb-2 inline-block text-sm text-muted hover:text-ink">{x.candidate.name}</Link>}
        title={t('dec.title')}
        subtitle={<span className="flex flex-wrap items-center gap-2">{x.candidate.name} — {x.job.title}{x.candidate.isSynthetic && <Badge tone="pending">{t('common.synthetic')}</Badge>}{x.currentDecision && <Badge tone="brand">{t(`out.${x.currentDecision.outcome}` as MessageKey)}</Badge>}</span>}
        actions={<Button onClick={() => window.print()}><Printer className="h-4 w-4" />PDF</Button>}
      />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Section
            title={t('dec.summary')}
            description={t('dec.summaryLabel')}
            actions={<Button size="sm" loading={busy === 'sum'} onClick={async () => { setBusy('sum'); setError(null); try { const r = await post(`/applications/${id}/summary`); await waitForJob(r.queue, r.queueJobId); await q.refetch(); } catch (e) { setError(e); } finally { setBusy(null); } }}><RefreshCw className="h-4 w-4" />{t('dec.regenerate')}</Button>}
          >
            {!s ? <p className="text-sm text-muted">{t('dec.noSummary')}</p> : (
              <div className="space-y-4 text-sm leading-6">
                <p className="text-base">{s.overall}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><h3 className="font-semibold text-valid">{t('dec.strengths')}</h3><ul className="mt-1 list-disc space-y-1 ps-5">{s.strengths.map((x: any, i: number) => <li key={i}>{x.text}{cites(x.evidenceIds)}</li>)}</ul></div>
                  <div><h3 className="font-semibold text-gap">{t('dec.weaknesses')}</h3>{s.weaknesses.length ? <ul className="mt-1 list-disc space-y-1 ps-5">{s.weaknesses.map((x: any, i: number) => <li key={i}>{x.text}{cites(x.evidenceIds)}</li>)}</ul> : <p className="text-muted">—</p>}</div>
                </div>
                {s.evidenceGaps.length > 0 && <div><h3 className="font-semibold">{t('dec.gaps')}</h3><p>{s.evidenceGaps.join(', ')}</p></div>}
                {s.risks.length > 0 && <div><h3 className="font-semibold">{t('dec.risks')}</h3><ul className="list-disc ps-5">{s.risks.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul></div>}
                <div><h3 className="font-semibold">{t('dec.consistency')}</h3><p>{s.consistency}</p></div>
                <div className="rounded border border-brand/30 bg-brand-soft px-3 py-2"><span className="font-semibold">{t('dec.nextStep')}:</span> {s.recommendedNextStep}</div>
              </div>
            )}
          </Section>
          <Section title={t('dec.scores')}>
            <EvidenceProfile profile={x.profile} />
          </Section>
          <Section title={t('dec.panel')}>
            {!x.profile.scorecards.length ? <Empty>{t('common.none')}</Empty> : (
              <ul className="divide-y divide-line text-sm">
                {x.profile.scorecards.map((sc: any) => (
                  <li key={sc.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{sc.interviewer.name} <span className="text-muted">— {sc.stageName}</span></span>
                    <span className="flex items-center gap-2"><Badge tone="brand">{sc.recommendation ? t(`rec.${sc.recommendation}` as MessageKey) : '—'}</Badge><span className="tnum text-muted">{fmtDate(sc.submittedAt, locale)}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title={t('dec.unresolved')}>
            {x.unresolvedAreas.length ? <ul className="list-disc ps-5 text-sm text-gap">{x.unresolvedAreas.map((a: string) => <li key={a}>{a}</li>)}</ul> : <p className="text-sm text-valid">{t('room.sufficient')}</p>}
            <p className="tnum mt-3 text-sm text-muted">{t('room.coverage')}: {fmtNum(x.profile.coverage.overall * 100, locale)}%</p>
          </Section>
          {can('decision.create') && (
            <Section title={t('dec.record')}>
              <form className="space-y-4" onSubmit={async (e) => {
                e.preventDefault();
                setBusy('dec'); setError(null);
                try { await post(`/applications/${id}/decisions`, { outcome, reason, acknowledgeGaps: ack }); setReason(''); setOutcome(''); setAck(false); setDone(true); await q.refetch(); } catch (err) { setError(err); } finally { setBusy(null); }
              }}>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">{t('dec.outcome')}</legend>
                  <div className="flex flex-wrap gap-2" role="radiogroup">
                    {OUTCOMES.map((o) => (
                      <button key={o} type="button" role="radio" aria-checked={outcome === o} onClick={() => setOutcome(o)}
                        className={cx('rounded border px-3 py-2 text-sm', outcome === o ? (o === 'REJECT' ? 'border-gap bg-gap-soft text-gap' : 'border-brand bg-brand-soft text-brand') + ' font-medium' : 'border-line hover:border-ink/30')}>{t(`out.${o}` as MessageKey)}</button>
                    ))}
                  </div>
                </fieldset>
                <Field label={t('dec.reason')} hint={t('dec.reasonHint')} htmlFor="reason"><Textarea id="reason" rows={5} required minLength={20} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                {needsAck && (
                  <label className="flex gap-2 rounded border border-gap/40 bg-gap-soft px-3 py-2 text-sm text-gap">
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
                    <span>{t('dec.acknowledge')} ({x.unresolvedAreas.join(', ')})</span>
                  </label>
                )}
                {error ? <ErrorNote error={error} /> : null}
                {done && <p className="text-sm text-valid" role="status">{t('dec.recorded')}</p>}
                <Button type="submit" variant="primary" loading={busy === 'dec'} disabled={!outcome || reason.trim().length < 20 || (needsAck && !ack)}>{t('dec.record')}</Button>
              </form>
            </Section>
          )}
          <Section title={t('dec.history')}>
            {!x.decisions.length ? <p className="text-sm text-muted">{t('common.none')}</p> : (
              <ol className="space-y-4">
                {x.decisions.map((d: any) => (
                  <li key={d.id} className="border-s-2 border-line ps-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><Badge tone={d.outcome === 'REJECT' ? 'gap' : 'brand'}>{t(`out.${d.outcome}` as MessageKey)}</Badge><span className="text-muted">{t('dec.by')} {d.decidedBy?.name}, <span className="tnum">{fmtDate(d.createdAt, locale)}</span></span></div>
                    <p className="mt-1 whitespace-pre-line">{d.reason}</p>
                    <p className="tnum mt-1 text-xs text-muted">{t('room.coverage')} {fmtNum(d.evidenceCoverage * 100, locale)}%{d.unresolvedAreas.length > 0 && ` — ${t('dec.unresolved')}: ${d.unresolvedAreas.join(', ')}`}{d.supersedesId && ` — ${t('dec.supersedes')}`}</p>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

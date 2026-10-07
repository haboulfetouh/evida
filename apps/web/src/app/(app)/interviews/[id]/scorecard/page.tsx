'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { get, post, put, waitForJob } from '@/lib/api';
import { fmtTs } from '@/lib/format';
import { EvidenceMeter, CoverageStatus } from '@/components/evidence-meter';
import { Badge, Button, cx, ErrorNote, Loading, PageHeader, Section, Select, Textarea } from '@/components/ui';

interface Draft { competencyId: string; value: number | null; confidence: 'low' | 'medium' | 'high'; comment: string; evidenceIds: string[]; touched: boolean }
const RECS = ['STRONG_HIRE', 'HIRE', 'CONSIDER', 'NO_HIRE', 'STRONG_NO_HIRE'];

export default function Scorecard() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const sc = useQuery({ queryKey: ['scorecard', id], queryFn: () => get(`/interviews/${id}/scorecard`) });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [rec, setRec] = useState<string>('');
  const [comments, setComments] = useState('');
  const [version, setVersion] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!sc.data) return;
    const d: Record<string, Draft> = {};
    for (const c of sc.data.competencies) {
      const s = c.score;
      d[c.competency.id] = { competencyId: c.competency.id, value: s?.value ?? null, confidence: (s?.confidence as Draft['confidence']) ?? 'medium', comment: s?.comment ?? '', evidenceIds: s?.evidenceIds ?? [], touched: !!s };
    }
    setDrafts(d);
    setRec(sc.data.recommendation ?? '');
    setComments(sc.data.comments ?? '');
    setVersion(sc.data.version);
  }, [sc.data]);

  if (sc.isLoading) return <Loading />;
  if (sc.error) return <ErrorNote error={sc.error} />;
  const x = sc.data;
  const locked = !!x.submittedAt;
  const set = (cid: string, p: Partial<Draft>) => { setSaved(false); setDrafts((d) => ({ ...d, [cid]: { ...d[cid], ...p, touched: true } })); };

  const save = async () => {
    const res = await put(`/scorecards/${x.id}`, {
      version,
      recommendation: rec || null,
      comments: comments || null,
      scores: Object.values(drafts).filter((d) => d.touched).map(({ touched, ...d }) => ({ ...d, comment: d.comment || null })),
    });
    setVersion(res.version);
    setSaved(true);
  };
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e) { setError(e); } finally { setBusy(null); }
  };

  return (
    <>
      <PageHeader
        back={<Link href={`/interviews/${id}`} className="mb-2 inline-block text-sm text-muted hover:text-ink">{t('common.back')}</Link>}
        title={t('sc.title')}
        subtitle={locked ? <Badge tone="valid">{t('sc.submitted')}</Badge> : x.interviewStatus !== 'COMPLETED' ? t('sc.notCompleted') : undefined}
        actions={!locked && (
          <Button size="sm" loading={busy === 'ai'} onClick={() => run('ai', async () => { const r = await post(`/interviews/${id}/score-suggestions`); await waitForJob(r.queue, r.queueJobId); await sc.refetch(); })}>
            <Sparkles className="h-4 w-4" />{t('sc.refreshSuggestions')}
          </Button>
        )}
      />
      {locked && <p className="mb-4 text-sm text-muted">{t('sc.locked')}</p>}
      <div className="space-y-5">
        {x.competencies.map((c: any) => {
          const d = drafts[c.competency.id];
          if (!d) return null;
          const ai = c.aiSuggestion;
          const validated = c.evidence.filter((e: any) => e.status !== 'AI_DETECTED').length;
          return (
            <Section
              key={c.competency.id}
              title={c.competency.name}
              description={c.competency.description}
              actions={<div className="flex items-center gap-3"><CoverageStatus status={c.coverage?.status ?? 'INSUFFICIENT_EVIDENCE'} /><EvidenceMeter validated={validated} pending={c.evidence.length - validated} /></div>}
            >
              <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
                <div className="space-y-4">
                  <fieldset disabled={locked}>
                    <legend className="mb-2 text-sm font-medium">{t('sc.score')}</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" aria-pressed={d.value === n} title={x.rubric?.[String(n)]} onClick={() => set(c.competency.id, { value: n })}
                          className={cx('tnum h-10 w-10 rounded border text-base font-semibold', d.value === n ? 'border-brand bg-brand text-white dark:text-paper' : 'border-line hover:border-ink/30')}>{n}</button>
                      ))}
                      <button type="button" aria-pressed={d.touched && d.value === null} onClick={() => set(c.competency.id, { value: null, evidenceIds: [] })}
                        className={cx('h-10 rounded border px-3 text-sm', d.touched && d.value === null ? 'border-gap bg-gap-soft text-gap' : 'border-line text-muted hover:border-ink/30')}>{t('sc.insufficient')}</button>
                    </div>
                    {d.value != null && x.rubric?.[String(d.value)] && <p className="mt-2 text-sm text-muted">{x.rubric[String(d.value)]}</p>}
                  </fieldset>
                  {ai && (
                    <div className="rounded border border-pending/40 bg-pending-soft/40 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span><span className="font-medium">{t('sc.aiSuggests')}:</span> <span className="tnum">{ai.score ?? t('sc.insufficient')}</span></span>
                        {!locked && <Button size="sm" variant="ghost" onClick={() => set(c.competency.id, { value: ai.score, evidenceIds: ai.evidenceIds })}>{t('sc.useSuggestion')}</Button>}
                      </div>
                      <p className="mt-1 text-xs text-muted">{ai.rationale}</p>
                      <p className="mt-1 text-xs text-pending">{ai.label}</p>
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-[230px_1fr]">
                    <Select aria-label={t('sc.confidence')} disabled={locked} value={d.confidence} onChange={(e) => set(c.competency.id, { confidence: e.target.value as Draft['confidence'] })}>
                      {(['low', 'medium', 'high'] as const).map((k) => <option key={k} value={k}>{t('sc.confidence')}: {t(`conf.${k}` as MessageKey)}</option>)}
                    </Select>
                    <Textarea aria-label={t('sc.comment')} placeholder={t('sc.comment')} rows={2} disabled={locked} value={d.comment} onChange={(e) => set(c.competency.id, { comment: e.target.value })} className="min-h-[40px]" />
                  </div>
                </div>
                <fieldset disabled={locked || d.value === null}>
                  <legend className="text-sm font-medium">{t('sc.linkEvidence')}</legend>
                  <p className="mb-2 text-xs text-muted">{t('sc.linkHint')}</p>
                  {c.evidence.length === 0 ? <p className="text-sm text-gap">{t('meter.missing')}</p> : (
                    <ul className="space-y-2">
                      {c.evidence.map((e: any) => {
                        const on = d.evidenceIds.includes(e.id);
                        return (
                          <li key={e.id}>
                            <label className={cx('flex cursor-pointer gap-2 rounded border px-3 py-2 text-sm', on ? 'border-brand bg-brand-soft/50' : 'border-line', e.status === 'AI_DETECTED' && !on && 'border-dashed border-pending/50')}>
                              <input type="checkbox" className="mt-1 accent-[rgb(var(--brand))]" checked={on} onChange={() => set(c.competency.id, { evidenceIds: on ? d.evidenceIds.filter((i) => i !== e.id) : [...d.evidenceIds, e.id] })} />
                              <span>
                                “{e.quote}”
                                <span className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted">
                                  {e.timestampSec != null && <span className="tnum">{fmtTs(e.timestampSec)}</span>}
                                  <Badge tone={e.status === 'AI_DETECTED' ? 'pending' : 'valid'}>{t(`ev.${e.status}` as MessageKey)}</Badge>
                                  {e.polarity === 'negative' && <Badge tone="gap">{t('ev.negative')}</Badge>}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </fieldset>
              </div>
            </Section>
          );
        })}

        <Section title={t('sc.overall')}>
          <fieldset disabled={locked} className="space-y-4">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('sc.overall')}>
              {RECS.map((r) => (
                <button key={r} type="button" role="radio" aria-checked={rec === r} onClick={() => { setRec(r); setSaved(false); }}
                  className={cx('rounded border px-3 py-2 text-sm', rec === r ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line hover:border-ink/30')}>{t(`rec.${r}` as MessageKey)}</button>
              ))}
            </div>
            <Textarea aria-label={t('sc.comments')} placeholder={t('sc.comments')} rows={4} value={comments} onChange={(e) => { setComments(e.target.value); setSaved(false); }} />
          </fieldset>
        </Section>
        {error ? <ErrorNote error={error} /> : null}
        {!locked && (
          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
            <Button loading={busy === 'save'} onClick={() => run('save', save)}>{t('sc.saveDraft')}</Button>
            <Button variant="primary" loading={busy === 'submit'} disabled={x.interviewStatus !== 'COMPLETED'} onClick={() => run('submit', async () => { await save(); await post(`/scorecards/${x.id}/submit`); await sc.refetch(); })}>{t('sc.submit')}</Button>
            {saved && <span className="text-sm text-valid" role="status">{t('common.saved')}</span>}
          </div>
        )}
      </div>
    </>
  );
}

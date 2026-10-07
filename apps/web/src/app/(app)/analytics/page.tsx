'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useI18n } from '@/i18n';
import { get } from '@/lib/api';
import { useCan } from '@/lib/session';
import { fmtDate, fmtNum, fmtPct } from '@/lib/format';
import { Bars } from '@/components/charts';
import { Button, Empty, ErrorNote, Loading, PageHeader, Section, Stat, Tabs } from '@/components/ui';

type Tab = 'quality' | 'coaching' | 'fairness' | 'ai';
const Th = ({ children }: { children: React.ReactNode }) => <th className="whitespace-nowrap px-3 py-2 text-start font-medium">{children}</th>;
const Td = ({ children, num }: { children: React.ReactNode; num?: boolean }) => <td className={num ? 'tnum whitespace-nowrap px-3 py-2' : 'px-3 py-2'}>{children}</td>;

export default function Analytics() {
  const { t, locale } = useI18n();
  const can = useCan();
  const [tab, setTab] = useState<Tab>('quality');
  const quality = useQuery({ queryKey: ['an', 'quality'], queryFn: () => get<any[]>('/analytics/interview-quality'), enabled: tab === 'quality' });
  const coach = useQuery({ queryKey: ['an', 'coach'], queryFn: () => get<any[]>('/analytics/interviewers'), enabled: tab === 'coaching' });
  const fair = useQuery({ queryKey: ['an', 'fair'], queryFn: () => get('/analytics/fairness'), enabled: tab === 'fairness' });
  const ai = useQuery({ queryKey: ['an', 'ai'], queryFn: () => get('/analytics/ai-usage'), enabled: tab === 'ai' });
  const csv = (path: string) => <a href={`/api/v1/reports/${path}`} download><Button size="sm"><Download className="h-4 w-4" />{t('common.export')}</Button></a>;
  const items: { value: Tab; label: string }[] = [{ value: 'quality', label: t('an.quality') }, { value: 'coaching', label: t('an.coaching') }, { value: 'fairness', label: t('an.fairness') }];
  if (can('ai.governance.read')) items.push({ value: 'ai', label: t('an.ai') });
  const state = (q: { isLoading: boolean; error: unknown }) => (q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : null);

  return (
    <>
      <PageHeader title={t('an.title')} actions={csv('funnel.csv')} />
      <Tabs value={tab} onChange={setTab} items={items} />
      <div className="mt-6 space-y-6">
        {tab === 'quality' && (state(quality) ?? (!quality.data?.length ? <Empty>{t('common.none')}</Empty> : (
          <Section title={t('an.quality')} actions={csv('interview-quality.csv')}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-muted"><tr><Th>{t('audit.when')}</Th><Th>{t('iv.round')}</Th><Th>{t('an.duration')}</Th><Th>{t('room.coverage')}</Th><Th>{t('an.talk')}</Th><Th>{t('an.questions')}</Th><Th>{t('an.followUps')}</Th><Th>{t('an.interruptions')}</Th><Th>{t('an.unanswered')}</Th><Th>{t('dec.variance')}</Th><Th>{t('dash.feedbackTime')}</Th><Th>★</Th></tr></thead>
                <tbody className="divide-y divide-line">
                  {quality.data.map((r) => (
                    <tr key={r.interviewId}>
                      <Td num>{fmtDate(r.endedAt, locale, { dateStyle: 'medium' })}</Td><Td>{r.job}, {r.stage}</Td><Td num>{fmtNum(r.durationMin, locale)} {t('common.minutes')}</Td>
                      <Td num>{fmtPct(r.evidenceCoveragePct, locale)}</Td><Td num>{r.hasTranscript ? fmtPct(r.candidateTalkPct, locale) : '—'}</Td><Td num>{r.hasTranscript ? r.questions : '—'}</Td>
                      <Td num>{r.hasTranscript ? r.followUps : '—'}</Td><Td num>{r.hasTranscript ? r.interruptions : '—'}</Td><Td num>{r.unansweredCompetencies}</Td><Td num>{fmtNum(r.scoreVariance, locale, 2)}</Td>
                      <Td num>{r.feedbackCompletionHours == null ? '—' : `${fmtNum(r.feedbackCompletionHours, locale, 1)} ${t('dash.hours')}`}</Td><Td num>{r.candidateExperience ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )))}

        {tab === 'coaching' && (state(coach) ?? (
          <Section title={t('an.coaching')} description={t('an.coachingNote')} actions={csv('interviewers.csv')}>
            {!coach.data?.length ? <Empty>{t('common.none')}</Empty> : (
              <ul className="divide-y divide-line">
                {coach.data.map((r) => (
                  <li key={r.interviewer.id} className="grid gap-4 py-4 lg:grid-cols-[200px_1fr_1fr]">
                    <div><div className="font-medium">{r.interviewer.name}</div><div className="tnum text-sm text-muted">{r.interviews} {t('jobs.interviews')}</div></div>
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-5">
                      <Stat label={t('room.coverage')} value={fmtPct(r.coveragePct, locale)} />
                      <Stat label={t('an.structured')} value={fmtPct(r.structuredQuestioningPct, locale)} />
                      <Stat label={t('an.talk')} value={fmtPct(r.candidateTalkPct, locale)} />
                      <Stat label={t('an.feedback')} value={fmtPct(r.feedbackCompletionPct, locale)} />
                      <Stat label={t('an.evidenceQuality')} value={fmtPct(r.evidenceQualityPct, locale)} />
                    </div>
                    <ul className="list-disc space-y-1 ps-5 text-sm">{r.suggestions.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ))}

        {tab === 'fairness' && (state(fair) ?? (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <Section title={t('an.distribution')}><Bars height={220} valueLabel={t('sc.score')} data={fair.data.scoreDistribution.map((d: any) => ({ label: String(d.score), value: d.count }))} /></Section>
              <Section title={t('an.calibration')} description={t('an.calibrationHelp')}>
                {!fair.data.interviewerCalibration.length ? <Empty>{t('common.none')}</Empty> : (
                  <ul className="divide-y divide-line text-sm">
                    {fair.data.interviewerCalibration.map((c: any) => (
                      <li key={c.interviewerId} className="flex items-center justify-between gap-3 py-2">
                        <span>{c.name} <span className="tnum text-muted">(n={c.samples})</span></span>
                        <span className="flex items-center gap-2">
                          <span className="relative h-2 w-32 rounded bg-ink/[0.06]" aria-hidden>
                            <span className="absolute inset-y-0 start-1/2 w-px bg-ink/30" />
                            <span className="absolute inset-y-0 rounded bg-[rgb(var(--chart))]" style={c.meanDeviationFromPanel >= 0 ? { insetInlineStart: '50%', width: `${Math.min(50, Math.abs(c.meanDeviationFromPanel) * 25)}%` } : { insetInlineEnd: '50%', width: `${Math.min(50, Math.abs(c.meanDeviationFromPanel) * 25)}%` }} />
                          </span>
                          <span className="tnum w-12 text-end">{c.meanDeviationFromPanel > 0 ? '+' : ''}{fmtNum(c.meanDeviationFromPanel, locale, 2)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
            <Section title={t('an.compVariance')}>
              <ul className="divide-y divide-line text-sm">{fair.data.competencyVariance.map((c: any) => <li key={c.competency} className="flex justify-between py-2"><span>{c.competency}</span><span className="tnum">{fmtNum(c.variance, locale, 2)} <span className="text-muted">(n={c.samples})</span></span></li>)}</ul>
            </Section>
            <Section title={t('an.adverse')}><p className="text-sm text-muted">{fair.data.adverseImpact.reason}</p></Section>
          </>
        ))}

        {tab === 'ai' && (state(ai) ?? (
          <>
            <section className="grid grid-cols-2 gap-6 rounded-md border border-line bg-surface px-6 py-5 md:grid-cols-4">
              <Stat label={t('an.runs')} value={fmtNum(ai.data.runs, locale)} />
              <Stat label={t('an.cost')} value={`$${fmtNum(ai.data.costUsd, locale, 2)}`} />
              <Stat label={t('an.costPerInterview')} value={ai.data.costPerInterviewUsd == null ? '—' : `$${fmtNum(ai.data.costPerInterviewUsd, locale, 3)}`} />
              <Stat label={t('an.latency')} value={`${fmtNum(ai.data.latencyP50Ms / 1000, locale, 1)}s / ${fmtNum(ai.data.latencyP95Ms / 1000, locale, 1)}s`} />
              <Stat label={t('an.acceptance')} value={fmtPct(ai.data.suggestionAcceptancePct, locale)} />
              <Stat label={t('an.override')} value={fmtPct(ai.data.humanOverridePct, locale)} />
              <Stat label={t('an.failures')} value={fmtNum(ai.data.failures, locale)} />
              <Stat label={t('gov.tokens')} value={fmtNum(ai.data.inputTokens + ai.data.outputTokens, locale)} />
            </section>
            <Section title={t('gov.purpose')} actions={csv('ai-usage.csv')}>
              <table className="w-full text-sm">
                <thead className="border-b border-line text-muted"><tr><Th>{t('gov.purpose')}</Th><Th>{t('an.runs')}</Th><Th>{t('an.failures')}</Th><Th>{t('an.cost')}</Th><Th>{t('gov.latency')}</Th><Th>{t('gov.model')}</Th></tr></thead>
                <tbody className="divide-y divide-line">{ai.data.byPurpose.map((p: any) => <tr key={p.purpose}><Td>{p.purpose}</Td><Td num>{p.runs}</Td><Td num>{p.failures}</Td><Td num>${fmtNum(p.costUsd, locale, 3)}</Td><Td num>{fmtNum(p.avgLatencyMs, locale)} ms</Td><Td>{p.models.join(', ')}</Td></tr>)}</tbody>
              </table>
            </Section>
          </>
        ))}
      </div>
    </>
  );
}

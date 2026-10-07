'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { get } from '@/lib/api';
import { useMe } from '@/lib/session';
import { fmtDate, fmtNum, fmtPct } from '@/lib/format';
import { Bars } from '@/components/charts';
import { Badge, Empty, ErrorNote, Loading, PageHeader, Section, Stat } from '@/components/ui';

export default function Dashboard() {
  const { t, locale } = useI18n();
  const { data: me } = useMe();
  const canAnalytics = me?.permissions.includes('analytics.read');
  const d = useQuery({ queryKey: ['dashboard'], queryFn: () => get('/analytics/dashboard'), enabled: !!canAnalytics });
  const mine = useQuery({ queryKey: ['interviews', 'mine', 'upcoming'], queryFn: () => get<any[]>(`/interviews?scope=mine&from=${new Date(Date.now() - 3600_000).toISOString()}`) });

  const upcoming = (
    <Section title={t('dash.upcoming')}>
      {mine.isLoading ? <Loading /> : !mine.data?.filter((i) => i.status !== 'CANCELLED' && i.status !== 'COMPLETED').length ? (
        <p className="text-sm text-muted">{t('iv.empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {mine.data.filter((i) => i.status !== 'CANCELLED' && i.status !== 'COMPLETED').slice(0, 6).map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <Link href={`/interviews/${i.id}`} className="min-w-0 hover:underline">
                <span className="font-medium">{i.candidate.name}</span> <span className="text-muted">— {i.job.title}, {i.stage}</span>
              </Link>
              <span className="tnum text-sm text-muted">{fmtDate(i.scheduledAt, locale)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );

  if (!canAnalytics) return (<><PageHeader title={t('dash.title')} />{upcoming}</>);
  if (d.isLoading) return <Loading />;
  if (d.error) return <ErrorNote error={d.error} onRetry={() => d.refetch()} />;
  const x = d.data;

  return (
    <>
      <PageHeader title={t('dash.title')} subtitle={me?.organization.name} />
      {/* The north-star metric leads: decisions that rest on complete evidence. */}
      <section className="mb-6 grid gap-6 rounded-md border border-line bg-surface px-6 py-5 lg:grid-cols-[1.2fr_2fr]">
        <div>
          <div className="text-sm text-muted">{t('dash.northStar')}</div>
          <div className="tnum mt-1 text-4xl font-semibold tracking-tight text-brand">{fmtPct(x.evidenceCompleteDecisionsPct, locale)}</div>
          <p className="mt-2 max-w-sm text-sm text-muted">{t('dash.northStarHelp')}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Stat label={t('dash.openPositions')} value={fmtNum(x.openPositions, locale)} />
          <Stat label={t('dash.candidates')} value={fmtNum(x.candidates, locale)} />
          <Stat label={t('dash.today')} value={fmtNum(x.interviewsToday, locale)} />
          <Stat label={t('dash.week')} value={fmtNum(x.interviewsThisWeek, locale)} />
          <Stat label={t('dash.coverage')} value={fmtPct(x.avgEvidenceCoveragePct, locale)} />
          <Stat label={t('dash.completion')} value={fmtPct(x.interviewCompletionPct, locale)} />
          <Stat label={t('dash.timeToHire')} value={x.avgTimeToHireDays == null ? '—' : `${fmtNum(x.avgTimeToHireDays, locale, 1)} ${t('dash.days')}`} />
          <Stat label={t('dash.feedback')} value={fmtPct(x.feedbackCompletionPct, locale)} />
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t('dash.funnel')}>
          {x.funnel.every((f: any) => !f.count) ? <Empty>{t('common.none')}</Empty> : (
            <Bars horizontal height={300} valueLabel={t('dash.candidates')} data={x.funnel.map((f: any) => ({ label: t(`stage.${f.stage}` as MessageKey), value: f.count }))} />
          )}
        </Section>
        <div className="space-y-6">
          <Section title={t('dash.decisions')}>
            <Bars height={200} valueLabel={t('dec.title')} data={x.decisionDistribution.map((f: any) => ({ label: t(`out.${f.outcome}` as MessageKey), value: f.count }))} />
          </Section>
          <Section title={t('dash.experience')}>
            <div className="flex flex-wrap items-baseline gap-8">
              <Stat label="★ / 5" value={x.candidateExperience.avgRating == null ? '—' : fmtNum(x.candidateExperience.avgRating, locale, 1)} />
              <span className="text-sm text-muted">{fmtNum(x.candidateExperience.responses, locale)} {t('dash.responses')}</span>
              <Stat label={t('dash.feedbackTime')} value={x.avgTimeToFeedbackHours == null ? '—' : `${fmtNum(x.avgTimeToFeedbackHours, locale, 1)} ${t('dash.hours')}`} />
            </div>
          </Section>
        </div>
      </div>
      <div className="mt-6">{upcoming}</div>
      {me?.organization.blindReviewEnabled && <p className="mt-4"><Badge tone="brand">{t('cand.blind')}</Badge></p>}
    </>
  );
}

'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { get } from '@/lib/api';
import { useCan } from '@/lib/session';
import { fmtNum } from '@/lib/format';
import { Badge, Button, Empty, ErrorNote, Loading, PageHeader } from '@/components/ui';

export default function Jobs() {
  const { t, locale } = useI18n();
  const can = useCan();
  const q = useQuery({ queryKey: ['jobs'], queryFn: () => get<any[]>('/jobs') });
  return (
    <>
      <PageHeader title={t('jobs.title')} actions={can('job.write') && <Link href="/jobs/new"><Button variant="primary"><Plus className="h-4 w-4" />{t('jobs.new')}</Button></Link>} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : !q.data?.length ? (
        <Empty action={can('job.write') && <Link href="/jobs/new"><Button variant="primary">{t('jobs.new')}</Button></Link>}>{t('jobs.empty')}</Empty>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line bg-surface">
          {q.data.map((j) => (
            <li key={j.id}>
              <Link href={`/jobs/${j.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-ink/[0.02]">
                <div className="min-w-0">
                  <div className="font-medium">{j.title}</div>
                  <div className="text-sm text-muted">{[j.department, j.location].filter(Boolean).join(', ')}</div>
                </div>
                <div className="flex items-center gap-5 text-sm text-muted">
                  <span className="tnum">{fmtNum(j.candidateCount, locale)} {t('jobs.candidates')}</span>
                  <span className="tnum">{fmtNum(j.interviewCount, locale)} {t('jobs.interviews')}</span>
                  <Badge tone={j.status === 'OPEN' ? 'valid' : 'neutral'}>{j.status === 'OPEN' ? t('jobs.form.statusOpen') : j.status.toLowerCase()}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

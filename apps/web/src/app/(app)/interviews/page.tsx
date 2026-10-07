'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { get } from '@/lib/api';
import { useCan } from '@/lib/session';
import { aiTone, fmtDate } from '@/lib/format';
import { Badge, Button, Empty, ErrorNote, Loading, PageHeader, Tabs } from '@/components/ui';


export default function Interviews() {
  const { t, locale } = useI18n();
  const can = useCan();
  const orgWide = can('candidate.read');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const q = useQuery({ queryKey: ['interviews', scope], queryFn: () => get<any[]>(`/interviews?scope=${scope}`) });
  const now = Date.now();
  const upcoming = q.data?.filter((i) => i.status === 'SCHEDULED' || i.status === 'IN_PROGRESS') ?? [];
  const past = q.data?.filter((i) => !(i.status === 'SCHEDULED' || i.status === 'IN_PROGRESS')).reverse() ?? [];
  const Row = ({ i }: { i: any }) => (
    <li>
      <Link href={`/interviews/${i.id}`} className="grid gap-2 px-5 py-3.5 hover:bg-ink/[0.02] sm:grid-cols-[160px_1fr_auto] sm:items-center">
        <span className="tnum text-sm text-muted">{fmtDate(i.scheduledAt, locale)}</span>
        <span className="min-w-0">
          <span className="font-medium">{i.candidate.name}</span> <span className="text-muted">— {i.job.title}, {i.stage}</span>
          <span className="block text-xs text-muted">{i.interviewers.map((p: any) => `${p.name}${p.submitted ? ' ✓' : ''}`).join(', ')}</span>
        </span>
        <span className="flex flex-wrap gap-1.5">
          <Badge tone={i.status === 'IN_PROGRESS' ? 'brand' : i.status === 'CANCELLED' ? 'gap' : 'neutral'}>{t(`iv.status.${i.status}` as MessageKey)}</Badge>
          {i.status === 'COMPLETED' && <Badge tone={aiTone(i.aiStatus)}>{t(`iv.ai.${i.aiStatus}` as MessageKey)}</Badge>}
          {i.status === 'SCHEDULED' && new Date(i.scheduledAt).getTime() < now && <Badge tone="pending">!</Badge>}
        </span>
      </Link>
    </li>
  );
  return (
    <>
      <PageHeader title={t('iv.title')} actions={can('interview.create') && <Link href="/interviews/new"><Button variant="primary"><Plus className="h-4 w-4" />{t('iv.schedule')}</Button></Link>} />
      {orgWide && <div className="mb-4"><Tabs value={scope} onChange={setScope} items={[{ value: 'mine', label: t('iv.mine') }, { value: 'all', label: t('iv.all') }]} /></div>}
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : !q.data?.length ? <Empty>{t('iv.empty')}</Empty> : (
        <div className="space-y-6">
          {upcoming.length > 0 && <ul className="divide-y divide-line rounded-md border border-line bg-surface">{upcoming.map((i) => <Row key={i.id} i={i} />)}</ul>}
          {past.length > 0 && <ul className="divide-y divide-line rounded-md border border-line bg-surface opacity-90">{past.map((i) => <Row key={i.id} i={i} />)}</ul>}
        </div>
      )}
    </>
  );
}

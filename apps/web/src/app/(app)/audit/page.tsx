'use client';
import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useI18n } from '@/i18n';
import { get } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Badge, Button, ErrorNote, Input, Loading, PageHeader } from '@/components/ui';

export default function Audit() {
  const { t, locale } = useI18n();
  const [action, setAction] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const h = setTimeout(() => setDebounced(action), 300); return () => clearTimeout(h); }, [action]);
  const q = useInfiniteQuery({
    queryKey: ['audit', debounced],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) => get(`/audit?${new URLSearchParams({ ...(debounced ? { action: debounced } : {}), ...(pageParam ? { cursor: pageParam } : {}) })}`),
    getNextPageParam: (last: any) => last.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p: any) => p.items) ?? [];
  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.note')} actions={<a href="/api/v1/reports/audit.csv" download><Button><Download className="h-4 w-4" />{t('common.export')}</Button></a>} />
      <Input className="mb-4 max-w-sm" placeholder={t('audit.filter')} aria-label={t('audit.filter')} value={action} onChange={(e) => setAction(e.target.value)} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorNote error={q.error} /> : (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-muted"><tr>{['audit.when', 'audit.actor', 'audit.action', 'audit.resource', 'audit.result'].map((k) => <th key={k} className="px-3 py-2 text-start font-medium">{t(k as any)}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((r: any) => (
                <tr key={r.id}>
                  <td className="tnum whitespace-nowrap px-3 py-2">{fmtDate(r.createdAt, locale, { dateStyle: 'short', timeStyle: 'medium' })}</td>
                  <td className="px-3 py-2">{r.actorName ?? r.actorType}</td>
                  <td className="px-3 py-2"><code>{r.action}</code></td>
                  <td className="px-3 py-2 text-muted">{r.resourceType}{r.resourceId ? ` ${String(r.resourceId).slice(0, 8)}` : ''}</td>
                  <td className="px-3 py-2"><Badge tone={r.result === 'SUCCESS' ? 'neutral' : 'gap'}>{r.result}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {q.hasNextPage && <Button className="mt-4" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>{t('audit.more')}</Button>}
    </>
  );
}

'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { get, post } from '@/lib/api';
import { useCan } from '@/lib/session';
import { Badge, Button, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Textarea } from '@/components/ui';

function NewCandidate({ jobId, onDone }: { jobId?: string; onDone: (id: string) => void }) {
  const { t } = useI18n();
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => get<any[]>('/jobs') });
  const [v, setV] = useState<Record<string, string>>({ jobId: jobId ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const c = await post('/candidates', {
            name: v.name, email: v.email, phone: v.phone || null, location: v.location || null, linkedinUrl: v.linkedinUrl || null,
            currentCompany: v.currentCompany || null, currentPosition: v.currentPosition || null, yearsExperience: v.yearsExperience ? Number(v.yearsExperience) : null,
            source: v.source || null, salaryExpectation: v.salaryExpectation || null, noticePeriod: v.noticePeriod || null, recruiterNotes: v.recruiterNotes || null,
            jobId: v.jobId || undefined,
          });
          onDone(c.id);
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('common.name')} htmlFor="n"><Input id="n" required value={v.name ?? ''} onChange={set('name')} /></Field>
        <Field label={t('common.email')} htmlFor="e"><Input id="e" type="email" required value={v.email ?? ''} onChange={set('email')} /></Field>
        <Field label={t('cand.form.phone')} htmlFor="p"><Input id="p" value={v.phone ?? ''} onChange={set('phone')} /></Field>
        <Field label={t('jobs.form.location')} htmlFor="l"><Input id="l" value={v.location ?? ''} onChange={set('location')} /></Field>
        <Field label={t('cand.form.company')} htmlFor="cc"><Input id="cc" value={v.currentCompany ?? ''} onChange={set('currentCompany')} /></Field>
        <Field label={t('cand.form.position')} htmlFor="cp"><Input id="cp" value={v.currentPosition ?? ''} onChange={set('currentPosition')} /></Field>
        <Field label={t('cand.form.years')} htmlFor="y"><Input id="y" type="number" min={0} max={60} step="0.5" value={v.yearsExperience ?? ''} onChange={set('yearsExperience')} /></Field>
        <Field label={t('cand.form.linkedin')} htmlFor="li"><Input id="li" type="url" placeholder="https://www.linkedin.com/in/…" value={v.linkedinUrl ?? ''} onChange={set('linkedinUrl')} /></Field>
        <Field label={t('cand.form.source')} htmlFor="s"><Input id="s" value={v.source ?? ''} onChange={set('source')} /></Field>
        <Field label={t('cand.form.notice')} htmlFor="np"><Input id="np" value={v.noticePeriod ?? ''} onChange={set('noticePeriod')} /></Field>
        <Field label={t('cand.form.salary')} htmlFor="se"><Input id="se" value={v.salaryExpectation ?? ''} onChange={set('salaryExpectation')} /></Field>
        <Field label={t('cand.form.job')} htmlFor="j">
          <Select id="j" value={v.jobId} onChange={set('jobId')}>
            <option value="">—</option>
            {jobs.data?.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={t('cand.form.notes')} htmlFor="rn"><Textarea id="rn" rows={3} value={v.recruiterNotes ?? ''} onChange={set('recruiterNotes')} /></Field>
      {error ? <ErrorNote error={error} /> : null}
      <Button type="submit" variant="primary" loading={busy}>{t('common.create')}</Button>
    </form>
  );
}

function Candidates() {
  const { t } = useI18n();
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [stage, setStage] = useState('');
  const [open, setOpen] = useState(params.get('new') === '1');
  useEffect(() => { const h = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(h); }, [q]);
  const list = useQuery({
    queryKey: ['candidates', debounced, stage],
    queryFn: () => get<any[]>(`/candidates?${new URLSearchParams({ ...(debounced ? { q: debounced } : {}), ...(stage ? { stage } : {}) })}`),
  });
  const stages = ['APPLIED', 'SCREENING', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'ASSESSMENT', 'FINAL_INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'ON_HOLD', 'WITHDRAWN'];
  return (
    <>
      <PageHeader title={t('cand.title')} actions={can('candidate.create') && <Button variant="primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t('cand.new')}</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-muted" aria-hidden />
          <Input aria-label={t('common.search')} placeholder={t('common.search')} className="ps-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select aria-label={t('cand.stage')} className="w-56" value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">{t('common.all')}</option>
          {stages.map((s) => <option key={s} value={s}>{t(`stage.${s}` as MessageKey)}</option>)}
        </Select>
      </div>
      {list.isLoading ? <Loading /> : list.error ? <ErrorNote error={list.error} /> : !list.data?.length ? <Empty>{t('cand.empty')}</Empty> : (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-start text-muted">
              <tr><th className="px-4 py-2.5 text-start font-medium">{t('common.name')}</th><th className="px-4 py-2.5 text-start font-medium">{t('cand.form.position')}</th><th className="px-4 py-2.5 text-start font-medium">{t('jobs.title')}</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.map((c) => (
                <tr key={c.id} className="hover:bg-ink/[0.02]">
                  <td className="px-4 py-3">
                    <Link href={`/candidates/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                    {c.isSynthetic && <Badge className="ms-2" tone="pending">{t('common.synthetic')}</Badge>}
                  </td>
                  <td className="px-4 py-3 text-muted">{[c.currentPosition, c.currentCompany].filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">{c.applications.map((a: any) => <Badge key={a.id}>{a.job.title}: {t(`stage.${a.stage}` as MessageKey)}</Badge>)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('cand.new')} wide>
        <NewCandidate jobId={params.get('jobId') ?? undefined} onDone={async (id) => { setOpen(false); await qc.invalidateQueries({ queryKey: ['candidates'] }); router.push(`/candidates/${id}`); }} />
      </Modal>
    </>
  );
}

export default function Page() {
  return <Suspense><Candidates /></Suspense>;
}

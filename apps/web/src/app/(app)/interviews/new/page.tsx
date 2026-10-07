'use client';
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { get, post } from '@/lib/api';
import { Button, cx, Empty, ErrorNote, Field, Input, PageHeader, Select, Toggle } from '@/components/ui';

function Schedule() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const cands = useQuery({ queryKey: ['candidates', 'all'], queryFn: () => get<any[]>('/candidates') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<any[]>('/users') });
  const org = useQuery({ queryKey: ['organization'], queryFn: () => get('/organization') });
  const apps = useMemo(() => (cands.data ?? []).flatMap((c) => c.applications.map((a: any) => ({ id: a.id, label: `${c.name} — ${a.job.title}`, jobId: a.job.id }))), [cands.data]);
  const [appId, setAppId] = useState(params.get('applicationId') ?? '');
  const app = apps.find((a) => a.id === appId);
  const job = useQuery({ queryKey: ['job', app?.jobId], queryFn: () => get(`/jobs/${app!.jobId}`), enabled: !!app });
  const plan = job.data?.plans.find((p: any) => p.status === 'ACTIVE');
  const [stageId, setStageId] = useState('');
  const [when, setWhen] = useState('');
  const [panel, setPanel] = useState<string[]>([]);
  const [lead, setLead] = useState('');
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const stage = plan?.stages.find((s: any) => s.id === stageId);

  return (
    <>
      <PageHeader title={t('iv.schedule')} />
      <form
        className="max-w-2xl space-y-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await post('/interviews', { applicationId: appId, stageId, scheduledAt: new Date(when).toISOString(), interviewerIds: panel, leadInterviewerId: lead || panel[0], recordingEnabled: recording });
            router.push(`/interviews/${r.id}?scheduled=1`);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t('iv.application')} htmlFor="app">
          <Select id="app" required value={appId} onChange={(e) => { setAppId(e.target.value); setStageId(''); }}>
            <option value="">—</option>
            {apps.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </Select>
        </Field>
        {app && job.data && !plan && <Empty>{t('plan.empty')}</Empty>}
        {plan && (
          <Field label={t('iv.round')} htmlFor="stage">
            <Select id="stage" required value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">—</option>
              {plan.stages.map((s: any) => <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes} {t('common.minutes')})</option>)}
            </Select>
          </Field>
        )}
        {stage && <p className="text-sm text-muted">{stage.competencyKeys.map((k: string) => job.data.competencies.find((c: any) => c.key === k)?.name ?? k).join(', ')}</p>}
        <Field label={t('iv.when')} htmlFor="when"><Input id="when" type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('iv.panel')}</legend>
          <div className="flex flex-wrap gap-2">
            {users.data?.filter((u) => u.isActive && u.roles.some((r: string) => ['INTERVIEWER', 'HIRING_MANAGER', 'HR_DIRECTOR', 'RECRUITER', 'ORG_ADMIN'].includes(r))).map((u) => {
              const on = panel.includes(u.id);
              return (
                <button type="button" key={u.id} aria-pressed={on} onClick={() => setPanel(on ? panel.filter((x) => x !== u.id) : [...panel, u.id])}
                  className={cx('rounded-sm border px-2.5 py-1.5 text-sm', on ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:border-ink/30')}>
                  {u.name}
                </button>
              );
            })}
          </div>
        </fieldset>
        {panel.length > 1 && (
          <Field label={t('iv.lead')} htmlFor="lead">
            <Select id="lead" value={lead || panel[0]} onChange={(e) => setLead(e.target.value)}>
              {panel.map((id) => <option key={id} value={id}>{users.data?.find((u) => u.id === id)?.name}</option>)}
            </Select>
          </Field>
        )}
        {org.data?.recordingEnabled && <Toggle id="rec" checked={recording} onChange={setRecording} label={t('iv.recording')} />}
        {error ? <ErrorNote error={error} /> : null}
        <Button type="submit" variant="primary" loading={busy} disabled={!appId || !stageId || !when || !panel.length}>{t('iv.schedule')}</Button>
      </form>
    </>
  );
}
export default function Page() {
  return <Suspense><Schedule /></Suspense>;
}

'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { del, get, patch, post, waitForJob } from '@/lib/api';
import { useCan } from '@/lib/session';
import { fmtNum } from '@/lib/format';
import { Bars } from '@/components/charts';
import { CompetencyEditor } from '@/components/competency-editor';
import { PlanBuilder } from '@/components/plan-builder';
import { JobForm, fromJob, toJobPayload } from '@/components/job-form';
import { Badge, Button, Empty, ErrorNote, Field, Input, Loading, Modal, OriginBadge, PageHeader, Section, Stat, Tabs, Textarea } from '@/components/ui';

const FUNNEL: Record<string, MessageKey> = { Application: 'stage.APPLIED', Screening: 'stage.SCREENING', Interview: 'nav.interviews', Final: 'stage.FINAL_INTERVIEW' };

type Tab = 'overview' | 'competencies' | 'plan' | 'candidates';

function JobPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { t, locale } = useI18n();
  const can = useCan();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) ?? 'overview');
  const job = useQuery({ queryKey: ['job', id], queryFn: () => get(`/jobs/${id}`) });
  const dash = useQuery({ queryKey: ['job', id, 'dashboard'], queryFn: () => get(`/jobs/${id}/dashboard`), enabled: tab === 'overview' });
  const apps = useQuery({ queryKey: ['candidates', { jobId: id }], queryFn: () => get<any[]>(`/candidates?jobId=${id}`), enabled: tab === 'candidates' && can('candidate.read') });
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  const [editJob, setEditJob] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [qFor, setQFor] = useState<string | null>(null);
  const [qText, setQText] = useState('');
  const [qFollow, setQFollow] = useState('');
  const [newPlan, setNewPlan] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['job', id] });

  if (job.isLoading) return <Loading />;
  if (job.error) return <ErrorNote error={job.error} />;
  const j = job.data;
  const comps = j.competencies as any[];
  const pendingAi = comps.filter((c) => c.origin === 'AI_GENERATED').length;

  const runAi = async (path: string, label: string) => {
    setAiBusy(label);
    setError(null);
    try {
      const r = await post(path);
      await waitForJob(r.queue, r.queueJobId);
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setAiBusy(null);
    }
  };
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await refresh(); } catch (e) { setError(e); }
  };

  return (
    <>
      <PageHeader
        back={<Link href="/jobs" className="mb-2 inline-block text-sm text-muted hover:text-ink">{t('jobs.title')}</Link>}
        title={j.title}
        subtitle={[j.department, j.location, j.employmentType].filter(Boolean).join(', ')}
        actions={can('job.write') && <Button onClick={() => setEditJob(true)}><Pencil className="h-4 w-4" />{t('common.edit')}</Button>}
      />
      <Tabs<Tab> value={tab} onChange={(v) => { setTab(v); router.replace(`/jobs/${id}?tab=${v}`); }} items={[
        { value: 'overview', label: t('jobs.tab.overview') },
        { value: 'competencies', label: `${t('jobs.tab.competencies')} (${comps.length})` },
        { value: 'plan', label: t('jobs.tab.plan') },
        { value: 'candidates', label: t('jobs.tab.candidates') },
      ]} />
      <div className="mt-6 space-y-6">
        {error ? <ErrorNote error={error} /> : null}

        {tab === 'overview' && (
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <Section title={t('dash.funnel')}>
              {dash.data ? (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Stat label={t('dash.candidates')} value={fmtNum(dash.data.candidates, locale)} />
                    <Stat label={t('nav.interviews')} value={fmtNum(dash.data.interviews, locale)} />
                    <Stat label={t('jobs.finalists')} value={fmtNum(dash.data.finalists, locale)} />
                    <Stat label={t('jobs.offers')} value={fmtNum(dash.data.offers, locale)} />
                  </div>
                  <Bars horizontal height={180} unit="%" valueLabel="%" data={dash.data.funnel.map((f: any) => ({ label: t(FUNNEL[f.stage] ?? 'stage.APPLIED'), value: f.pct }))} />
                </>
              ) : <Loading />}
            </Section>
            <Section title={t('jobs.form.description')}>
              <p className="whitespace-pre-line text-sm leading-6">{j.description}</p>
              {j.requiredSkills.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{j.requiredSkills.map((s: string) => <Badge key={s}>{s}</Badge>)}</div>}
            </Section>
          </div>
        )}

        {tab === 'competencies' && (
          <Section
            title={t('comp.title')}
            description={pendingAi ? t('comp.pendingNote') : undefined}
            actions={can('competency.write') && (
              <>
                <Button onClick={() => runAi(`/jobs/${id}/competencies/generate`, 'comp')} loading={aiBusy === 'comp'}><Sparkles className="h-4 w-4" />{aiBusy === 'comp' ? t('comp.generating') : t('comp.generate')}</Button>
                {pendingAi > 0 && can('competency.approve') && <Button variant="primary" onClick={() => act(() => post(`/jobs/${id}/competencies/approve`))}>{t('comp.approveAll')} ({pendingAi})</Button>}
                <Button onClick={() => setEditing(null)}><Plus className="h-4 w-4" />{t('comp.add')}</Button>
              </>
            )}
          >
            {!comps.length ? <Empty>{t('comp.empty')}</Empty> : (
              <ul className="divide-y divide-line">
                {comps.map((c) => (
                  <li key={c.id} className="py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{c.name}</h3>
                          <OriginBadge origin={c.origin} />
                        </div>
                        <p className="mt-1 text-sm text-muted">{c.description}</p>
                        <p className="tnum mt-1 text-xs text-muted">{t('comp.weight')} {c.weight} — {t('comp.level')} {c.requiredLevel}/5</p>
                      </div>
                      {can('competency.write') && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label={t('common.edit')}><Pencil className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" onClick={() => act(() => del(`/competencies/${c.id}`))} aria-label={t('common.delete')}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      )}
                    </div>
                    {(c.indicators as string[]).length > 0 && (
                      <ul className="mt-2 list-disc ps-5 text-sm">{(c.indicators as string[]).map((i, k) => <li key={k}>{i}</li>)}</ul>
                    )}
                    <div className="mt-3 space-y-2">
                      {c.questions.map((q: any) => (
                        <div key={q.id} className="rounded border border-line px-3 py-2 text-sm">
                          <div className="flex items-start justify-between gap-2">
                            <span>{q.text}</span>
                            {can('competency.write') && <button className="text-muted hover:text-gap" onClick={() => act(() => del(`/questions/${q.id}`))} aria-label={t('common.delete')}><Trash2 className="h-3.5 w-3.5" /></button>}
                          </div>
                          {q.followUps.length > 0 && <p className="mt-1 text-muted">{t('comp.followUps')}: {q.followUps.join(' / ')}</p>}
                        </div>
                      ))}
                      {can('competency.write') && <button className="text-sm text-brand hover:underline" onClick={() => { setQFor(c.id); setQText(''); setQFollow(''); }}>{t('comp.addQuestion')}</button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {tab === 'plan' && (
          <>
            <div className="flex flex-wrap gap-2">
              {can('plan.write') && (
                <>
                  <Button onClick={() => runAi(`/jobs/${id}/plans/generate`, 'plan')} loading={aiBusy === 'plan'} disabled={!comps.length}><Sparkles className="h-4 w-4" />{aiBusy === 'plan' ? t('plan.generating') : t('plan.generate')}</Button>
                  <Button onClick={() => setNewPlan(true)} disabled={!comps.length}><Plus className="h-4 w-4" />{t('plan.new')}</Button>
                </>
              )}
            </div>
            {newPlan && (
              <Section title={t('plan.new')}>
                <PlanBuilder
                  comps={comps}
                  initial={{ name: `${j.title} — ${t('plan.title')}`, stages: [{ id: crypto.randomUUID(), name: t('plan.round') + ' 1', durationMinutes: 45, competencyKeys: [] }] }}
                  onSave={async (p) => { await post(`/jobs/${id}/interview-plans`, p); setNewPlan(false); await refresh(); }}
                />
              </Section>
            )}
            {!j.plans.length && !newPlan ? <Empty>{t('plan.empty')}</Empty> : j.plans.map((p: any) => (
              <Section
                key={`${p.id}-${p.version}`}
                title={<span className="flex flex-wrap items-center gap-2">{p.name} <Badge tone={p.status === 'ACTIVE' ? 'valid' : 'neutral'}>{t(p.status === 'ACTIVE' ? 'plan.active' : p.status === 'DRAFT' ? 'plan.draft' : 'plan.archived')}</Badge><OriginBadge origin={p.origin} /></span>}
                description={p.status === 'ACTIVE' ? t('plan.locked') : undefined}
                actions={
                  <>
                    {p.status === 'DRAFT' && can('plan.approve') && <Button variant="primary" onClick={() => act(() => post(`/interview-plans/${p.id}/approve`))}>{t('plan.approve')}</Button>}
                    {p.status !== 'DRAFT' && can('plan.write') && <Button onClick={() => act(() => post(`/interview-plans/${p.id}/duplicate`))}>{t('plan.duplicate')}</Button>}
                  </>
                }
              >
                <PlanBuilder
                  comps={comps}
                  disabled={p.status !== 'DRAFT' || !can('plan.write')}
                  initial={{ name: p.name, stages: p.stages.map((s: any) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, competencyKeys: s.competencyKeys })) }}
                  onSave={async (np) => { await patch(`/interview-plans/${p.id}`, { ...np, scoringRubric: p.scoringRubric }); await refresh(); }}
                />
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-muted">{t('plan.rubric')}</summary>
                  <dl className="mt-2 space-y-1">{Object.entries(p.scoringRubric as Record<string, string>).map(([k, v]) => <div key={k} className="flex gap-3"><dt className="tnum w-4 font-semibold">{k}</dt><dd>{v}</dd></div>)}</dl>
                </details>
              </Section>
            ))}
          </>
        )}

        {tab === 'candidates' && (
          <Section title={t('jobs.tab.candidates')} actions={can('candidate.create') && <Link href={`/candidates?new=1&jobId=${id}`}><Button><Plus className="h-4 w-4" />{t('cand.new')}</Button></Link>}>
            {apps.isLoading ? <Loading /> : !apps.data?.length ? <Empty>{t('cand.empty')}</Empty> : (
              <ul className="divide-y divide-line">
                {apps.data.map((c) => {
                  const a = c.applications.find((x: any) => x.job.id === id);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <Link href={`/candidates/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                      <div className="flex items-center gap-3">
                        <Badge>{t(`stage.${a?.stage}` as MessageKey)}</Badge>
                        {a && <Link className="text-sm text-brand hover:underline" href={`/applications/${a.id}/decision`}>{t('cand.decision')}</Link>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        )}
      </div>

      <Modal open={editing !== undefined} onClose={() => setEditing(undefined)} title={editing ? editing.name : t('comp.add')} wide>
        <CompetencyEditor jobId={id} competency={editing ?? undefined} onDone={() => { setEditing(undefined); refresh(); }} />
      </Modal>
      <Modal open={!!qFor} onClose={() => setQFor(null)} title={t('comp.addQuestion')}>
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); await act(() => post(`/competencies/${qFor}/questions`, { text: qText, followUps: qFollow.split('\n').map((x) => x.trim()).filter(Boolean) })); setQFor(null); }}>
          <Field label={t('room.question')} htmlFor="qt"><Textarea id="qt" required minLength={5} rows={3} value={qText} onChange={(e) => setQText(e.target.value)} /></Field>
          <Field label={t('comp.followUps')} hint={t('common.onePerLine')} htmlFor="qf"><Textarea id="qf" rows={3} value={qFollow} onChange={(e) => setQFollow(e.target.value)} /></Field>
          <Button type="submit" variant="primary">{t('common.add')}</Button>
        </form>
      </Modal>
      <Modal open={editJob} onClose={() => setEditJob(false)} title={t('common.edit')} wide>
        <JobForm initial={fromJob(j)} submitLabel={t('common.save')} onSubmit={async (v) => { await patch(`/jobs/${id}`, { ...toJobPayload(v), version: j.version }); setEditJob(false); await refresh(); }} />
      </Modal>
    </>
  );
}

export default function Page() {
  return <Suspense><JobPage /></Suspense>;
}

'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { del, get, patch, post } from '@/lib/api';
import { useCan, useMe } from '@/lib/session';
import { fmtDate } from '@/lib/format';
import { Badge, Button, cx, ErrorNote, Field, Input, Loading, Modal, PageHeader, Section, Select, Tabs, Toggle } from '@/components/ui';

const ROLES = ['ORG_ADMIN', 'HR_DIRECTOR', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER', 'VIEWER'];
const EVENTS = ['candidate.created', 'candidate.updated', 'interview.created', 'interview.scheduled', 'interview.started', 'interview.completed', 'transcript.ready', 'evidence.ready', 'scorecard.completed', 'decision.created', 'candidate.hired', 'candidate.rejected'];
type Tab = 'org' | 'users' | 'webhooks';

function OrgSettings() {
  const { t } = useI18n();
  const q = useQuery({ queryKey: ['organization'], queryFn: () => get('/organization') });
  const [v, setV] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => { if (q.data) setV(q.data); }, [q.data]);
  if (!v) return <Loading />;
  const r = v.retention;
  const setR = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, retention: { ...r, [k]: Number(e.target.value) } });
  return (
    <Section>
      <form className="max-w-2xl space-y-6" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError(null); setOk(false);
        try { await patch('/organization', { name: v.name, locale: v.locale, blindReviewEnabled: v.blindReviewEnabled, recordingEnabled: v.recordingEnabled, consentPolicyVersion: v.consentPolicyVersion, retention: r }); setOk(true); q.refetch(); } catch (err) { setError(err); } finally { setBusy(false); }
      }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('auth.register.orgName')} htmlFor="on"><Input id="on" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label={t('set.locale')} htmlFor="ol"><Select id="ol" value={v.locale} onChange={(e) => setV({ ...v, locale: e.target.value })}><option value="en">English</option><option value="ar">العربية</option></Select></Field>
        </div>
        <Toggle id="blind" checked={v.blindReviewEnabled} onChange={(x) => setV({ ...v, blindReviewEnabled: x })} label={t('set.blind')} help={t('set.blindHelp')} />
        <Toggle id="recording" checked={v.recordingEnabled} onChange={(x) => setV({ ...v, recordingEnabled: x })} label={t('set.recording')} help={t('set.recordingHelp')} />
        <Field label={t('set.consentVersion')} htmlFor="cv"><Input id="cv" value={v.consentPolicyVersion} onChange={(e) => setV({ ...v, consentPolicyVersion: e.target.value })} /></Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('set.retention')}</legend>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label={t('set.retention.recordings')} htmlFor="r1"><Input id="r1" type="number" min={1} value={r.recordingsDays} onChange={setR('recordingsDays')} /></Field>
            <Field label={t('set.retention.transcripts')} htmlFor="r2"><Input id="r2" type="number" min={1} value={r.transcriptsDays} onChange={setR('transcriptsDays')} /></Field>
            <Field label={t('set.retention.candidates')} htmlFor="r3"><Input id="r3" type="number" min={30} value={r.candidatesDays} onChange={setR('candidatesDays')} /></Field>
            <Field label={t('set.retention.audit')} htmlFor="r4"><Input id="r4" type="number" min={365} value={r.auditDays} onChange={setR('auditDays')} /></Field>
          </div>
        </fieldset>
        {error ? <ErrorNote error={error} /> : null}
        <div className="flex items-center gap-3"><Button type="submit" variant="primary" loading={busy}>{t('common.save')}</Button>{ok && <span className="text-sm text-valid">{t('common.saved')}</span>}</div>
      </form>
    </Section>
  );
}

function Users() {
  const { t, locale } = useI18n();
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['users'], queryFn: () => get<any[]>('/users') });
  const [open, setOpen] = useState(false);
  const [inv, setInv] = useState({ name: '', email: '', roles: ['INTERVIEWER'] });
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const toggleRole = (roles: string[], r: string) => (roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);
  const update = async (id: string, body: object) => { setError(null); try { await patch(`/users/${id}`, body); q.refetch(); } catch (e) { setError(e); } };
  return (
    <Section title={t('set.users')} actions={<Button variant="primary" onClick={() => setOpen(true)}>{t('set.invite')}</Button>}>
      {msg && <p className="mb-3 text-sm text-valid" role="status">{msg}</p>}
      {error ? <div className="mb-3"><ErrorNote error={error} /></div> : null}
      {q.isLoading ? <Loading /> : (
        <ul className="divide-y divide-line">
          {q.data?.map((u) => (
            <li key={u.id} className={cx('grid gap-3 py-3 md:grid-cols-[1fr_2fr_auto] md:items-center', !u.isActive && 'opacity-60')}>
              <div className="min-w-0"><div className="font-medium">{u.name}</div><div className="truncate text-sm text-muted">{u.email}</div><div className="tnum text-xs text-muted">{u.lastLoginAt ? fmtDate(u.lastLoginAt, locale) : '—'}</div></div>
              <div className="flex flex-wrap gap-1.5">
                {ROLES.map((r) => {
                  const on = u.roles.includes(r);
                  return <button key={r} aria-pressed={on} disabled={u.id === me?.id && r === 'ORG_ADMIN'} onClick={() => { const roles = toggleRole(u.roles, r); if (roles.length) update(u.id, { roles }); }}
                    className={cx('rounded-sm border px-2 py-1 text-xs', on ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted hover:text-ink', 'disabled:opacity-60')}>{t(`role.${r}` as MessageKey)}</button>;
                })}
              </div>
              {u.id !== me?.id && <Button size="sm" variant={u.isActive ? 'danger' : 'secondary'} onClick={() => update(u.id, { isActive: !u.isActive })}>{u.isActive ? t('set.deactivate') : t('set.activate')}</Button>}
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t('set.invite')}>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setError(null);
          try { await post('/users', inv); setOpen(false); setInv({ name: '', email: '', roles: ['INTERVIEWER'] }); setMsg(t('set.inviteSent')); q.refetch(); } catch (err) { setError(err); }
        }}>
          <Field label={t('common.name')} htmlFor="in"><Input id="in" required value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></Field>
          <Field label={t('common.email')} htmlFor="ie"><Input id="ie" type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></Field>
          <fieldset><legend className="mb-2 text-sm font-medium">{t('common.role')}</legend>
            <div className="flex flex-wrap gap-1.5">{ROLES.map((r) => <button type="button" key={r} aria-pressed={inv.roles.includes(r)} onClick={() => setInv({ ...inv, roles: toggleRole(inv.roles, r) })} className={cx('rounded-sm border px-2 py-1 text-sm', inv.roles.includes(r) ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted')}>{t(`role.${r}` as MessageKey)}</button>)}</div>
          </fieldset>
          {error ? <ErrorNote error={error} /> : null}
          <Button type="submit" variant="primary" disabled={!inv.roles.length}>{t('set.invite')}</Button>
        </form>
      </Modal>
    </Section>
  );
}

function Webhooks() {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: ['webhooks'], queryFn: () => get<any[]>('/webhooks') });
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['decision.created']);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="space-y-6">
      <Section title={t('set.addWebhook')}>
        <form className="max-w-2xl space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setError(null);
          try { const r = await post('/webhooks', { url, events }); setSecret(r.secret); setUrl(''); q.refetch(); } catch (err) { setError(err); }
        }}>
          <Field label={t('set.webhookUrl')} htmlFor="wu"><Input id="wu" type="url" required placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
          <fieldset><legend className="mb-2 text-sm font-medium">{t('set.webhookEvents')}</legend>
            <div className="flex flex-wrap gap-1.5">{EVENTS.map((ev) => <button type="button" key={ev} aria-pressed={events.includes(ev)} onClick={() => setEvents(events.includes(ev) ? events.filter((x) => x !== ev) : [...events, ev])} className={cx('rounded-sm border px-2 py-1 font-mono text-xs', events.includes(ev) ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted')}>{ev}</button>)}</div>
          </fieldset>
          {error ? <ErrorNote error={error} /> : null}
          <Button type="submit" variant="primary" disabled={!events.length}>{t('set.addWebhook')}</Button>
        </form>
        {secret && (
          <div className="mt-4 rounded border border-pending/40 bg-pending-soft px-4 py-3 text-sm">
            <p>{t('set.webhookSecret')}</p>
            <div className="mt-2 flex items-center gap-2"><code className="break-all">{secret}</code><Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(secret)} aria-label={t('common.copy')}><Copy className="h-4 w-4" /></Button></div>
          </div>
        )}
      </Section>
      <Section title={t('set.webhooks')}>
        {q.isLoading ? <Loading /> : !q.data?.length ? <p className="text-sm text-muted">{t('common.none')}</p> : (
          <ul className="divide-y divide-line">
            {q.data.map((h) => (
              <li key={h.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="break-all font-medium">{h.url} <span className="text-muted">{h.secretHint}</span></span>
                  {h.isActive ? <Button size="sm" variant="danger" onClick={async () => { await del(`/webhooks/${h.id}`); q.refetch(); }}>{t('set.deactivate')}</Button> : <Badge>{t('set.deactivate')}</Badge>}
                </div>
                <p className="mt-1 font-mono text-xs text-muted">{h.events.join(', ')}</p>
                {h.recentDeliveries.length > 0 && <ul className="mt-2 space-y-0.5 text-xs">{h.recentDeliveries.map((d: any) => <li key={d.id} className="tnum"><Badge tone={d.status === 'DELIVERED' ? 'valid' : d.status === 'PENDING' ? 'neutral' : 'gap'}>{d.status}</Badge> {d.event} — {fmtDate(d.createdAt, locale)} {d.lastError ?? ''}</li>)}</ul>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export default function Settings() {
  const { t } = useI18n();
  const can = useCan();
  const [tab, setTab] = useState<Tab>('org');
  const items: { value: Tab; label: string }[] = [{ value: 'org', label: t('set.org') }];
  if (can('user.manage')) items.push({ value: 'users', label: t('set.users') });
  if (can('integration.manage')) items.push({ value: 'webhooks', label: t('set.webhooks') });
  return (
    <>
      <PageHeader title={t('set.title')} />
      <Tabs value={tab} onChange={setTab} items={items} />
      <div className="mt-6">{tab === 'org' ? <OrgSettings /> : tab === 'users' ? <Users /> : <Webhooks />}</div>
    </>
  );
}

'use client';
import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { patch, post } from '@/lib/api';
import { fmtNum, fmtTs } from '@/lib/format';
import { Badge, Button, cx, ErrorNote, Field, Input, Select, Textarea } from './ui';

const tone = (s: string) => (s === 'AI_DETECTED' ? 'pending' : s === 'REJECTED' ? 'gap' : 'valid') as 'pending' | 'gap' | 'valid';

/** Evidence with human validation controls. AI detections are visibly distinct until reviewed. */
export function EvidenceList({ items, competencies, canValidate, onChanged }: { items: any[]; competencies: { id: string; name: string }[]; canValidate: boolean; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ summary: '', competencyId: '' });
  const [error, setError] = useState<unknown>(null);
  const act = async (e: any, action: 'confirm' | 'reject' | 'edit', extra: object = {}) => {
    setError(null);
    try { await patch(`/evidence/${e.id}`, { action, version: e.version, ...extra }); setEditing(null); onChanged(); } catch (err) { setError(err); }
  };
  if (!items.length) return <p className="py-4 text-sm text-muted">{t('ev.empty')}</p>;
  return (
    <div className="space-y-3">
      {error ? <ErrorNote error={error} /> : null}
      <ul className="space-y-3">
        {items.map((e) => (
          <li key={e.id} className={cx('rounded border px-3 py-2.5', e.status === 'AI_DETECTED' ? 'border-pending/40 bg-pending-soft/40' : e.status === 'REJECTED' ? 'border-line opacity-60' : 'border-line')}>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium">{e.competency?.name}</span>
              <Badge tone={tone(e.status)}>{t(`ev.${e.status}` as MessageKey)}</Badge>
              {e.type === 'INFERRED' && <Badge tone="pending">{t('ev.inferred')}</Badge>}
              {e.polarity === 'negative' && <Badge tone="gap">{t('ev.negative')}</Badge>}
              {e.timestampSec != null && <span className="tnum text-muted">{fmtTs(e.timestampSec)}</span>}
              {e.status === 'AI_DETECTED' && <span className="tnum text-muted">{t('ev.confidence')} {fmtNum(e.confidence * 100, locale)}%</span>}
            </div>
            <blockquote className="mt-1.5 text-sm">“{e.quote}”</blockquote>
            {editing === e.id ? (
              <div className="mt-2 space-y-2">
                <Input aria-label={t('ev.summary')} value={draft.summary} onChange={(x) => setDraft({ ...draft, summary: x.target.value })} />
                <Select aria-label={t('ev.competency')} value={draft.competencyId} onChange={(x) => setDraft({ ...draft, competencyId: x.target.value })}>
                  {competencies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => act(e, 'edit', draft)}>{t('common.save')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-xs text-muted">{e.summary}</p>
            )}
            {canValidate && editing !== e.id && e.status !== 'REJECTED' && (
              <div className="mt-2 flex gap-1">
                {e.status === 'AI_DETECTED' && <Button size="sm" onClick={() => act(e, 'confirm')}><Check className="h-3.5 w-3.5" />{t('ev.confirm')}</Button>}
                <Button size="sm" variant="ghost" onClick={() => act(e, 'reject')}><X className="h-3.5 w-3.5" />{t('ev.reject')}</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(e.id); setDraft({ summary: e.summary, competencyId: e.competencyId }); }}><Pencil className="h-3.5 w-3.5" />{t('ev.edit')}</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AddEvidence({ interviewId, competencies, onDone }: { interviewId: string; competencies: { id: string; name: string }[]; onDone: () => void }) {
  const { t } = useI18n();
  const [v, setV] = useState({ competencyId: competencies[0]?.id ?? '', quote: '', summary: '', polarity: 'positive' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setError(null);
      try { await post(`/interviews/${interviewId}/evidence`, v); setV({ ...v, quote: '', summary: '' }); onDone(); } catch (err) { setError(err); } finally { setBusy(false); }
    }}>
      <Field label={t('ev.competency')} htmlFor="ac">
        <Select id="ac" value={v.competencyId} onChange={(e) => setV({ ...v, competencyId: e.target.value })}>{competencies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
      </Field>
      <Field label={t('ev.quote')} htmlFor="aq"><Textarea id="aq" rows={2} required minLength={3} value={v.quote} onChange={(e) => setV({ ...v, quote: e.target.value })} /></Field>
      <Field label={t('ev.summary')} htmlFor="as"><Input id="as" required minLength={3} value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} /></Field>
      <Select aria-label={t('ev.positive')} value={v.polarity} onChange={(e) => setV({ ...v, polarity: e.target.value })}>
        <option value="positive">{t('ev.positive')}</option><option value="negative">{t('ev.negative')}</option>
      </Select>
      {error ? <ErrorNote error={error} /> : null}
      <Button type="submit" size="sm" variant="primary" loading={busy}>{t('room.addEvidence')}</Button>
    </form>
  );
}

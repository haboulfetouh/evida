'use client';
import { useState } from 'react';
import { useI18n } from '@/i18n';
import { patch, post } from '@/lib/api';
import { Button, ErrorNote, Field, Input, Textarea } from './ui';

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export function CompetencyEditor({ jobId, competency, onDone }: { jobId: string; competency?: any; onDone: () => void }) {
  const { t } = useI18n();
  const c = competency;
  const [v, setV] = useState({
    key: c?.key ?? '', name: c?.name ?? '', description: c?.description ?? '', weight: c?.weight ?? 1, requiredLevel: c?.requiredLevel ?? 3,
    evaluationCriteria: c?.evaluationCriteria ?? '', indicators: (c?.indicators ?? []).join('\n'), positiveExamples: (c?.positiveExamples ?? []).join('\n'), negativeExamples: (c?.negativeExamples ?? []).join('\n'),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      key: v.key || v.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'competency',
      name: v.name, description: v.description, weight: Number(v.weight), requiredLevel: Number(v.requiredLevel), evaluationCriteria: v.evaluationCriteria || null,
      indicators: lines(v.indicators), positiveExamples: lines(v.positiveExamples), negativeExamples: lines(v.negativeExamples),
    };
    try {
      if (c) await patch(`/competencies/${c.id}`, body);
      else await post(`/jobs/${jobId}/competencies`, body);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field label={t('common.name')} htmlFor="cn"><Input id="cn" required value={v.name} onChange={set('name')} /></Field>
        <Field label={t('comp.key')} htmlFor="ck" hint="snake_case"><Input id="ck" value={v.key} onChange={set('key')} disabled={!!c} pattern="[a-z][a-z0-9_]{1,48}" /></Field>
      </div>
      <Field label={t('comp.description')} htmlFor="cd"><Textarea id="cd" required rows={3} value={v.description} onChange={set('description')} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label={`${t('comp.weight')} (0.5–3)`} htmlFor="cw"><Input id="cw" type="number" step="0.1" min={0.5} max={3} value={v.weight} onChange={set('weight')} /></Field>
        <Field label={`${t('comp.level')} (1–5)`} htmlFor="cl"><Input id="cl" type="number" min={1} max={5} value={v.requiredLevel} onChange={set('requiredLevel')} /></Field>
      </div>
      <Field label={t('comp.criteria')} htmlFor="ce"><Textarea id="ce" rows={2} value={v.evaluationCriteria} onChange={set('evaluationCriteria')} /></Field>
      <Field label={t('comp.indicators')} hint={t('common.onePerLine')} htmlFor="ci"><Textarea id="ci" rows={3} value={v.indicators} onChange={set('indicators')} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('comp.positive')} htmlFor="cp"><Textarea id="cp" rows={3} value={v.positiveExamples} onChange={set('positiveExamples')} /></Field>
        <Field label={t('comp.negative')} htmlFor="cng"><Textarea id="cng" rows={3} value={v.negativeExamples} onChange={set('negativeExamples')} /></Field>
      </div>
      {error ? <ErrorNote error={error} /> : null}
      <Button type="submit" variant="primary" loading={busy}>{t('common.save')}</Button>
    </form>
  );
}

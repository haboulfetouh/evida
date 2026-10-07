'use client';
import { useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2 } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button, cx, ErrorNote, Field, Input } from './ui';

export interface StageDraft { id: string; name: string; durationMinutes: number; competencyKeys: string[] }

function Round({ s, index, comps, onChange, onRemove, disabled }: { s: StageDraft; index: number; comps: { key: string; name: string }[]; onChange: (s: StageDraft) => void; onRemove: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id, disabled });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cx('rounded-md border border-line bg-surface', isDragging && 'shadow-panel')}>
      <div className="flex items-center gap-3 border-b border-line px-3 py-2">
        {!disabled && <button type="button" {...attributes} {...listeners} className="cursor-grab rounded p-1 text-muted hover:bg-ink/5" aria-label={`${t('plan.round')} ${index + 1}`}><GripVertical className="h-4 w-4" /></button>}
        <span className="tnum whitespace-nowrap text-sm text-muted">{t('plan.round')} {index + 1}</span>
        <Input aria-label={t('common.name')} className="h-8 min-w-0 flex-1" value={s.name} disabled={disabled} onChange={(e) => onChange({ ...s, name: e.target.value })} />
        <Input aria-label={t('common.minutes')} type="number" min={10} max={240} className="h-8 w-20" value={s.durationMinutes} disabled={disabled} onChange={(e) => onChange({ ...s, durationMinutes: Number(e.target.value) })} />
        <span className="text-sm text-muted">{t('common.minutes')}</span>
        {!disabled && <button type="button" className="rounded p-1 text-muted hover:text-gap" onClick={onRemove} aria-label={t('common.remove')}><Trash2 className="h-4 w-4" /></button>}
      </div>
      <div className="flex flex-wrap gap-2 px-3 py-3">
        {comps.map((c) => {
          const on = s.competencyKeys.includes(c.key);
          return (
            <button
              type="button"
              key={c.key}
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onChange({ ...s, competencyKeys: on ? s.competencyKeys.filter((k) => k !== c.key) : [...s.competencyKeys, c.key] })}
              className={cx('rounded-sm border px-2 py-1 text-sm', on ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted hover:text-ink')}
            >
              {c.name}
            </button>
          );
        })}
      </div>
    </li>
  );
}

export function PlanBuilder({ initial, comps, disabled, onSave }: { initial: { name: string; stages: StageDraft[] }; comps: { key: string; name: string }[]; disabled?: boolean; onSave?: (p: { name: string; stages: Omit<StageDraft, 'id'>[] }) => Promise<void> }) {
  const { t } = useI18n();
  const [name, setName] = useState(initial.name);
  const [stages, setStages] = useState<StageDraft[]>(initial.stages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = stages.findIndex((s) => s.id === e.active.id);
    const to = stages.findIndex((s) => s.id === e.over!.id);
    setStages(arrayMove(stages, from, to));
  };
  const covered = new Set(stages.flatMap((s) => s.competencyKeys));
  const uncovered = comps.filter((c) => !covered.has(c.key));
  return (
    <div className="space-y-4">
      <Field label={t('common.name')} htmlFor="pn"><Input id="pn" value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} /></Field>
      {!disabled && <p className="text-sm text-muted">{t('plan.dragHint')}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-3">
            {stages.map((s, i) => (
              <Round key={s.id} s={s} index={i} comps={comps} disabled={disabled} onChange={(n) => setStages(stages.map((x) => (x.id === s.id ? n : x)))} onRemove={() => setStages(stages.filter((x) => x.id !== s.id))} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {uncovered.length > 0 && <p className="text-sm text-gap">{t('plan.uncovered')}: {uncovered.map((c) => c.name).join(', ')}</p>}
      {error ? <ErrorNote error={error} /> : null}
      {!disabled && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => setStages([...stages, { id: crypto.randomUUID(), name: `${t('plan.round')} ${stages.length + 1}`, durationMinutes: 45, competencyKeys: [] }])}>{t('plan.addRound')}</Button>
          {onSave && (
            <Button
              variant="primary"
              loading={busy}
              disabled={!stages.length || stages.some((s) => !s.competencyKeys.length || s.name.trim().length < 2)}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onSave({ name, stages: stages.map(({ id, ...s }) => s) });
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('common.save')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

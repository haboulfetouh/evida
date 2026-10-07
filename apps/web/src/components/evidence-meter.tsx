'use client';
import { useI18n } from '@/i18n';
import { cx } from './ui';

/**
 * EVIDA's signature element. One competency = one row of slots (default target 3):
 *   solid green       = validated evidence (confirmed, edited, or added by an interviewer)
 *   amber hatch       = AI-detected, not yet reviewed by a person
 *   grey dashed slot  = evidence still missing
 * The same meter is used in the room, scorecard, evidence profile and decision screens.
 */
export function EvidenceMeter({ validated, pending, target = 3, size = 'md' }: { validated: number; pending: number; target?: number; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const v = Math.min(validated, target);
  const p = Math.min(pending, target - v);
  const slots = Array.from({ length: target }, (_, i) => (i < v ? 'v' : i < v + p ? 'p' : 'e'));
  const label = `${validated} ${t('meter.validated')}, ${pending} ${t('meter.pending')}`;
  return (
    <div className="flex items-center gap-1" role="img" aria-label={label} title={label}>
      {slots.map((s, i) => (
        <span
          key={i}
          className={cx(
            'rounded-[2px]',
            size === 'sm' ? 'h-2 w-5' : 'h-2.5 w-8',
            s === 'v' && 'bg-valid',
            s === 'p' && 'hatch',
            s === 'e' && 'border border-dashed border-muted/60',
          )}
        />
      ))}
      {validated + pending > target && <span className="tnum text-xs text-muted">+{validated + pending - target}</span>}
    </div>
  );
}

export function CoverageStatus({ status }: { status: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT_EVIDENCE' }) {
  const { t } = useI18n();
  if (status === 'SUFFICIENT') return <span className="text-xs font-medium text-valid">{t('meter.sufficient')}</span>;
  if (status === 'PARTIAL') return <span className="text-xs font-medium text-pending">{t('meter.partial')}</span>;
  return <span className="text-xs font-medium text-gap">{t('meter.missing')}</span>;
}

export interface CoverageRow {
  competencyId: string;
  name: string;
  coverage: number;
  validatedCount: number;
  pendingCount: number;
  status: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT_EVIDENCE';
}

/** Coverage list: competency name, meter, status. Used live in the interview room. */
export function CoverageList({ rows, compact, twoColumn }: { rows: CoverageRow[]; compact?: boolean; twoColumn?: boolean }) {
  return (
    <ul className={cx(twoColumn ? 'grid gap-x-10 sm:grid-cols-2 [&>li]:border-b [&>li]:border-line' : 'divide-y divide-line')}>
      {rows.map((r) => (
        <li key={r.competencyId} className={cx('flex items-center justify-between gap-3', compact ? 'py-2' : 'py-2.5')}>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{r.name}</div>
            <CoverageStatus status={r.status} />
          </div>
          <EvidenceMeter validated={r.validatedCount} pending={r.pendingCount} size={compact ? 'sm' : 'md'} />
        </li>
      ))}
    </ul>
  );
}

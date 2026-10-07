'use client';
import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Loader2, X } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { ApiError } from '@/lib/api';

/** clsx + tailwind-merge, so a caller's width/height overrides a component default. */
export const cx = (...v: ClassValue[]) => twMerge(clsx(v));

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }>(
  ({ variant = 'secondary', size = 'md', loading, className, children, disabled, ...p }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-brand text-white hover:bg-brand/90 dark:text-paper',
        variant === 'secondary' && 'border border-line bg-surface hover:border-ink/30',
        variant === 'ghost' && 'hover:bg-ink/5',
        variant === 'danger' && 'border border-gap/40 text-gap hover:bg-gap-soft',
        className,
      )}
      {...p}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

const field = 'w-full rounded border border-line bg-surface px-3 text-base placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cx(field, 'h-10', className)} {...p} />);
Input.displayName = 'Input';
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cx(field, 'py-2 min-h-[96px]', className)} {...p} />);
Textarea.displayName = 'Textarea';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cx(field, 'h-10', className)} {...p} />);
Select.displayName = 'Select';

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
      {children}
      {error ? <p className="text-sm text-gap" role="alert">{error}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

type Tone = 'neutral' | 'brand' | 'valid' | 'pending' | 'gap';
export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        tone === 'neutral' && 'bg-ink/[0.06] text-ink/80',
        tone === 'brand' && 'bg-brand-soft text-brand',
        tone === 'valid' && 'bg-valid-soft text-valid',
        tone === 'pending' && 'bg-pending-soft text-pending',
        tone === 'gap' && 'bg-gap-soft text-gap',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Labels AI-generated content until a human approves it. */
export function OriginBadge({ origin }: { origin: 'HUMAN' | 'AI_GENERATED' | 'AI_APPROVED' }) {
  const { t } = useI18n();
  if (origin === 'HUMAN') return null;
  return origin === 'AI_GENERATED' ? <Badge tone="pending">{t('common.aiGenerated')}</Badge> : <Badge tone="brand">{t('common.aiApproved')}</Badge>;
}

export function Section({ title, actions, children, className, description }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; description?: ReactNode }) {
  return (
    <section className={cx('rounded-md border border-line bg-surface', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, help }: { label: string; value: ReactNode; help?: string }) {
  return (
    <div className="min-w-0" title={help}>
      <div className="text-sm text-muted">{label}</div>
      <div className="tnum mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line px-6 py-10 text-center text-muted">
      <p className="mx-auto max-w-md">{children}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 py-10 text-muted" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t('common.loading')}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  const e = error as ApiError;
  const msg = e?.status === 403 ? t('error.forbidden') : e?.status === 404 ? t('error.notFound') : e?.message || t('error.generic');
  const issues = Array.isArray(e?.issues) ? (e.issues as unknown[]) : [];
  return (
    <div className="rounded border border-gap/30 bg-gap-soft px-4 py-3 text-sm text-gap" role="alert">
      <p>{msg}</p>
      {issues.length > 0 && (
        <ul className="mt-1 list-disc ps-5">
          {issues.map((i, k) => <li key={k}>{typeof i === 'string' ? i : (i as { path?: string; message?: string }).message ?? JSON.stringify(i)}</li>)}
        </ul>
      )}
      {onRetry && <button className="mt-2 underline" onClick={onRetry}>{t('common.retry')}</button>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={cx('-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap', value === i.value ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink')}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} className={cx('w-[calc(100%-32px)] rounded-lg border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-ink/30', wide ? 'max-w-3xl' : 'max-w-lg')}>
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        <button onClick={onClose} aria-label={t('common.close')} className="rounded p-1 hover:bg-ink/5"><X className="h-4 w-4" /></button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{open && children}</div>
    </dialog>
  );
}

export function Toggle({ checked, onChange, label, help, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string; id: string }) {
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-ink/20')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'start-[18px]' : 'start-0.5')} />
      </button>
      <label htmlFor={id} className="text-sm">
        <span className="font-medium">{label}</span>
        {help && <span className="block text-muted">{help}</span>}
      </label>
    </div>
  );
}

export const tKey = (prefix: string, v: string) => `${prefix}.${v}` as MessageKey;

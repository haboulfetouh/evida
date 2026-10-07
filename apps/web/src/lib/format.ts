import type { Locale } from '@/i18n';

export const fmtDate = (d: string | Date | null | undefined, locale: Locale, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }) =>
  d ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', opts).format(new Date(d)) : '—';
export const fmtNum = (n: number | null | undefined, locale: Locale, digits = 0) =>
  n == null ? '—' : new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
export const fmtPct = (n: number | null | undefined, locale: Locale) => (n == null ? '—' : `${fmtNum(n, locale)}%`);
export const fmtTs = (sec: number | null | undefined) => {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? [h, m, s] : [m, s]).map((n) => String(n).padStart(2, '0')).join(':');
};
export const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export const aiTone = (s: string) => (s === 'READY' ? 'valid' : s === 'FAILED' ? 'gap' : s === 'PROCESSING' || s === 'QUEUED' ? 'pending' : 'neutral') as 'valid' | 'gap' | 'pending' | 'neutral';

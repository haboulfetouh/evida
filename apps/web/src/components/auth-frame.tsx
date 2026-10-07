'use client';
import type { ReactNode } from 'react';
import { useI18n } from '@/i18n';
import { Logo } from './logo';
import { EvidenceMeter } from './evidence-meter';

/** Sign-in pages: the form on one side, the product idea (evidence accumulating per competency) on the other. */
export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <div className="flex items-center justify-between">
          <Logo />
          <button className="text-sm text-muted hover:text-ink" onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}>{t('nav.language')}</button>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="mb-6 text-2xl font-semibold tracking-tight">{title}</h1>
          {children}
        </div>
      </div>
      <div className="hidden flex-col justify-center border-s border-line bg-surface px-16 lg:flex">
        <p className="max-w-md text-3xl font-semibold leading-tight tracking-tight">{t('app.tagline')}</p>
        <div className="mt-10 max-w-sm space-y-4" aria-hidden>
          {(locale === 'ar'
            ? [['القيادة التقنية', 3, 0], ['إدارة الأفراد', 2, 1], ['التفكير الاستراتيجي', 1, 1], ['الفطنة التجارية', 0, 0]]
            : [['Technical Leadership', 3, 0], ['People Management', 2, 1], ['Strategic Thinking', 1, 1], ['Business Acumen', 0, 0]]
          ).map(([name, v, p]) => (
            <div key={name as string} className="flex items-center justify-between gap-6 border-b border-line pb-3">
              <span className="text-sm">{name}</span>
              <EvidenceMeter validated={v as number} pending={p as number} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

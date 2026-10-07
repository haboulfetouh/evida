'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './en';
import { ar } from './ar';

export type Locale = 'en' | 'ar';
const dicts: Record<Locale, Record<MessageKey, string>> = { en, ar };

interface I18n {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: (key: MessageKey) => string;
  setLocale: (l: Locale) => void;
}
const Ctx = createContext<I18n | null>(null);

function initialLocale(): Locale {
  if (typeof document === 'undefined') return 'en';
  const m = document.cookie.match(/(?:^|; )evida_locale=(en|ar)/);
  return (m?.[1] as Locale) ?? (navigator.language?.startsWith('ar') ? 'ar' : 'en');
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, set] = useState<Locale>('en');
  useEffect(() => set(initialLocale()), []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    document.cookie = `evida_locale=${l}; path=/; max-age=31536000; samesite=lax`;
    set(l);
  }, []);
  const value = useMemo<I18n>(() => ({ locale, dir: locale === 'ar' ? 'rtl' : 'ltr', t: (k) => dicts[locale][k] ?? en[k] ?? k, setLocale }), [locale, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useI18n outside provider');
  return c;
}
export type { MessageKey };

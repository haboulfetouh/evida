'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, Bell, Briefcase, CalendarClock, FileClock, LayoutGrid, LogOut, Menu, Scale, Settings, Users, X } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { useMe } from '@/lib/session';
import { get, post } from '@/lib/api';
import { Logo } from './logo';
import { cx, Loading } from './ui';

const NAV: { href: string; key: MessageKey; icon: typeof LayoutGrid; perm?: string }[] = [
  { href: '/dashboard', key: 'nav.dashboard', icon: LayoutGrid, perm: 'analytics.read' },
  { href: '/jobs', key: 'nav.jobs', icon: Briefcase, perm: 'job.read' },
  { href: '/candidates', key: 'nav.candidates', icon: Users, perm: 'candidate.read' },
  { href: '/interviews', key: 'nav.interviews', icon: CalendarClock, perm: 'interview.read' },
  { href: '/analytics', key: 'nav.analytics', icon: BarChart3, perm: 'analytics.read' },
  { href: '/ai-governance', key: 'nav.governance', icon: Scale, perm: 'ai.governance.read' },
  { href: '/audit', key: 'nav.audit', icon: FileClock, perm: 'audit.read' },
  { href: '/settings', key: 'nav.settings', icon: Settings, perm: 'org.manage' },
];

export function Shell({ children }: { children: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  const { data: me, isLoading, error } = useMe();
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<{ id: string; title: string; link?: string; status: string }[]>([]);
  const [showNotifs, setShowNotifs] = useState(false);

  useEffect(() => {
    if (error) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [error, path, router]);
  useEffect(() => {
    if (me && me.organization.locale && !document.cookie.includes('evida_locale=')) setLocale(me.organization.locale);
  }, [me, setLocale]);
  useEffect(() => {
    if (!me) return;
    const load = () => get('/notifications').then(setNotifs).catch(() => undefined);
    load();
    const i = setInterval(load, 60_000);
    return () => clearInterval(i);
  }, [me]);
  useEffect(() => setOpen(false), [path]);

  if (isLoading || !me) return <div className="p-8"><Loading /></div>;
  const items = NAV.filter((n) => !n.perm || me.permissions.includes(n.perm));
  const unread = notifs.filter((n) => n.status !== 'READ').length;

  const signOut = async () => {
    await post('/auth/logout').catch(() => undefined);
    qc.clear();
    router.replace('/login');
  };

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/dashboard" aria-label="EVIDA"><Logo /></Link>
        <button className="md:hidden" onClick={() => setOpen(false)} aria-label={t('common.close')}><X className="h-5 w-5" /></button>
      </div>
      <div className="px-4 pb-3 text-sm text-muted truncate">{me.organization.name}</div>
      <ul className="flex-1 space-y-0.5 px-2">
        {items.map((n) => {
          const active = path === n.href || path.startsWith(`${n.href}/`);
          return (
            <li key={n.href}>
              <Link href={n.href} aria-current={active ? 'page' : undefined} className={cx('flex items-center gap-2.5 rounded px-2.5 py-2 text-sm', active ? 'bg-brand-soft font-medium text-brand' : 'text-ink/80 hover:bg-ink/5')}>
                <n.icon className="h-4 w-4" aria-hidden />
                {t(n.key)}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="space-y-1 border-t border-line p-3 text-sm">
        <div className="px-1 font-medium truncate">{me.name}</div>
        <div className="px-1 text-xs text-muted truncate">{me.roles.map((r) => t(`role.${r}` as MessageKey)).join(', ')}</div>
        <div className="flex items-center gap-1 pt-2">
          <button className="rounded px-2 py-1 hover:bg-ink/5" onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')} lang={locale === 'en' ? 'ar' : 'en'}>{t('nav.language')}</button>
          <button className="ms-auto inline-flex items-center gap-1.5 rounded px-2 py-1 hover:bg-ink/5" onClick={signOut}><LogOut className="h-4 w-4" aria-hidden />{t('nav.signOut')}</button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <aside className="hidden border-e border-line bg-surface md:block md:sticky md:top-0 md:h-screen">{nav}</aside>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 w-64 bg-surface">{nav}</aside>
        </div>
      )}
      <div className="min-w-0">
        <header className="flex h-14 items-center gap-3 bg-brand px-4 text-white dark:bg-surface dark:text-ink md:px-8">
          <button className="md:hidden" onClick={() => setOpen(true)} aria-label="Menu"><Menu className="h-5 w-5" /></button>
          <span className="md:hidden"><Logo compact inverse /></span>
          <div className="relative ms-auto">
            <button className="relative rounded p-2 hover:bg-white/15" aria-label={`Notifications (${unread})`} onClick={() => setShowNotifs((s) => !s)}>
              <Bell className="h-4 w-4" />
              {unread > 0 && <span className="absolute end-1 top-1 h-2 w-2 rounded-full bg-white ring-2 ring-brand" />}
            </button>
            {showNotifs && (
              <div className="absolute end-0 z-30 mt-2 w-80 rounded-md border border-line bg-surface text-ink shadow-panel">
                {notifs.length === 0 ? (
                  <p className="p-4 text-sm text-muted">{t('common.none')}</p>
                ) : (
                  <ul className="max-h-96 divide-y divide-line overflow-y-auto">
                    {notifs.map((n) => (
                      <li key={n.id}>
                        <button
                          className={cx('w-full px-4 py-3 text-start text-sm hover:bg-ink/5', n.status !== 'READ' && 'font-medium')}
                          onClick={async () => {
                            await post(`/notifications/${n.id}/read`).catch(() => undefined);
                            setShowNotifs(false);
                            setNotifs((all) => all.map((x) => (x.id === n.id ? { ...x, status: 'READ' } : x)));
                            if (n.link) router.push(n.link);
                          }}
                        >
                          {n.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-[1280px] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

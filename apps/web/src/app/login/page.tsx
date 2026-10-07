'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AuthFrame } from '@/components/auth-frame';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { useI18n } from '@/i18n';
import { ApiError, post } from '@/lib/api';

function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [org, setOrg] = useState('');
  const [needOrg, setNeedOrg] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [magicSent, setMagicSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { email, password, organization: org || undefined });
      await qc.invalidateQueries();
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ORG_REQUIRED') setNeedOrg(true);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame title={t('auth.signIn')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('common.email')} htmlFor="email"><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={t('auth.password')} htmlFor="password"><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {needOrg && <Field label={t('auth.organization')} htmlFor="org"><Input id="org" value={org} onChange={(e) => setOrg(e.target.value)} /></Field>}
        {error ? <ErrorNote error={error} /> : null}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>{busy ? t('auth.signingIn') : t('auth.signIn')}</Button>
      </form>
      <div className="mt-4">
        {magicSent ? (
          <p className="text-sm text-muted">{t('auth.magicSent')}</p>
        ) : (
          <button
            className="text-sm text-brand hover:underline disabled:opacity-50"
            disabled={!email}
            onClick={async () => {
              await post('/auth/magic-link', { email }).catch(() => undefined);
              setMagicSent(true);
            }}
          >
            {t('auth.magic')}
          </button>
        )}
      </div>
      <p className="mt-10 text-sm text-muted">
        {t('auth.noAccount')} <Link className="text-brand hover:underline" href="/register">{t('auth.createOrg')}</Link>
      </p>
    </AuthFrame>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}

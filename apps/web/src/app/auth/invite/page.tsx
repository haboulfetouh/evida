'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AuthFrame } from '@/components/auth-frame';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { useI18n } from '@/i18n';
import { post } from '@/lib/api';

function Invite() {
  const { t } = useI18n();
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <AuthFrame title={t('auth.invite.title')}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post('/auth/magic-link/consume', { token, password: pw });
            router.replace('/dashboard');
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t('auth.password')} htmlFor="pw" hint={t('auth.register.passwordHint')}>
          <Input id="pw" type="password" minLength={12} required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        {error ? <ErrorNote error={error} /> : null}
        <Button type="submit" variant="primary" className="w-full" loading={busy}>{t('auth.invite.submit')}</Button>
      </form>
    </AuthFrame>
  );
}
export default function Page() {
  return <Suspense><Invite /></Suspense>;
}

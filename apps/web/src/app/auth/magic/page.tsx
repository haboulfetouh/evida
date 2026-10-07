'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthFrame } from '@/components/auth-frame';
import { Loading } from '@/components/ui';
import { useI18n } from '@/i18n';
import { post } from '@/lib/api';

function Magic() {
  const { t } = useI18n();
  const token = useSearchParams().get('token');
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const once = useRef(false);
  useEffect(() => {
    if (once.current || !token) return;
    once.current = true;
    post('/auth/magic-link/consume', { token }).then(() => router.replace('/dashboard')).catch(() => setFailed(true));
  }, [token, router]);
  return (
    <AuthFrame title={t('auth.magic.consuming')}>
      {failed || !token ? <p className="text-gap">{t('auth.linkInvalid')} <Link href="/login" className="underline">{t('auth.signIn')}</Link></p> : <Loading />}
    </AuthFrame>
  );
}
export default function Page() {
  return <Suspense><Magic /></Suspense>;
}

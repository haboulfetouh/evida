'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { AuthFrame } from '@/components/auth-frame';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { useI18n } from '@/i18n';
import { post } from '@/lib/api';

const schema = z.object({
  organizationName: z.string().trim().min(2),
  name: z.string().trim().min(2),
  email: z.string().email(),
  password: z.string().min(12),
});

export default function RegisterPage() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const submit = handleSubmit(async (v) => {
    setError(null);
    try {
      await post('/auth/register', { ...v, locale });
      router.replace('/jobs/new');
    } catch (e) {
      setError(e);
    }
  });
  return (
    <AuthFrame title={t('auth.register.title')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t('auth.register.orgName')} htmlFor="org" error={formState.errors.organizationName && ' '}><Input id="org" {...register('organizationName')} /></Field>
        <Field label={t('auth.register.yourName')} htmlFor="name"><Input id="name" autoComplete="name" {...register('name')} /></Field>
        <Field label={t('common.email')} htmlFor="email"><Input id="email" type="email" autoComplete="email" {...register('email')} /></Field>
        <Field label={t('auth.password')} htmlFor="pw" hint={t('auth.register.passwordHint')} error={formState.errors.password ? t('auth.register.passwordHint') : undefined}>
          <Input id="pw" type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        {error ? <ErrorNote error={error} /> : null}
        <Button type="submit" variant="primary" className="w-full" loading={formState.isSubmitting}>{t('auth.register.submit')}</Button>
      </form>
      <p className="mt-8 text-sm text-muted"><Link href="/login" className="text-brand hover:underline">{t('auth.signIn')}</Link></p>
    </AuthFrame>
  );
}

'use client';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '@/i18n';
import { get } from '@/lib/api';
import { Button, ErrorNote, Field, Input, Select, Textarea, Toggle } from './ui';

export interface JobValues {
  title: string; department?: string; location?: string; employmentType?: string; description: string; requiredExperience?: string;
  requiredSkills: string; preferredSkills: string; salaryRange?: string; hiringManagerId?: string; positions: number; openingDate?: string; closingDate?: string; open: boolean;
}

const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
export const toJobPayload = (v: JobValues) => ({
  title: v.title, department: v.department || null, location: v.location || null, employmentType: v.employmentType || null, description: v.description,
  requiredExperience: v.requiredExperience || null, requiredSkills: split(v.requiredSkills), preferredSkills: split(v.preferredSkills), salaryRange: v.salaryRange || null,
  hiringManagerId: v.hiringManagerId || null, positions: Number(v.positions) || 1, openingDate: v.openingDate || null, closingDate: v.closingDate || null, status: v.open ? 'OPEN' : 'DRAFT',
});
export const fromJob = (j: any): JobValues => ({
  ...j, department: j.department ?? '', location: j.location ?? '', employmentType: j.employmentType ?? '', requiredExperience: j.requiredExperience ?? '', salaryRange: j.salaryRange ?? '',
  hiringManagerId: j.hiringManagerId ?? '', requiredSkills: j.requiredSkills.join(', '), preferredSkills: j.preferredSkills.join(', '),
  openingDate: j.openingDate?.slice(0, 10) ?? '', closingDate: j.closingDate?.slice(0, 10) ?? '', open: j.status === 'OPEN',
});

export function JobForm({ initial, onSubmit, submitLabel }: { initial?: Partial<JobValues>; onSubmit: (v: JobValues) => Promise<void>; submitLabel: string }) {
  const { t } = useI18n();
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<any[]>('/users') });
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState, watch, setValue } = useForm<JobValues>({ defaultValues: { positions: 1, open: true, requiredSkills: '', preferredSkills: '', ...initial } });
  const submit = handleSubmit(async (v) => {
    setError(null);
    try { await onSubmit(v); } catch (e) { setError(e); }
  });
  return (
    <form onSubmit={submit} className="max-w-3xl space-y-5">
      <Field label={t('jobs.form.title')} htmlFor="title"><Input id="title" required minLength={2} {...register('title', { required: true })} /></Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label={t('jobs.form.department')} htmlFor="dep"><Input id="dep" {...register('department')} /></Field>
        <Field label={t('jobs.form.location')} htmlFor="loc"><Input id="loc" {...register('location')} /></Field>
        <Field label={t('jobs.form.type')} htmlFor="type"><Input id="type" {...register('employmentType')} /></Field>
      </div>
      <Field label={t('jobs.form.description')} htmlFor="desc"><Textarea id="desc" rows={8} required minLength={20} {...register('description', { required: true, minLength: 20 })} /></Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('jobs.form.requiredSkills')} hint={t('jobs.form.skillsHint')} htmlFor="rs"><Input id="rs" {...register('requiredSkills')} /></Field>
        <Field label={t('jobs.form.preferredSkills')} hint={t('jobs.form.skillsHint')} htmlFor="ps"><Input id="ps" {...register('preferredSkills')} /></Field>
        <Field label={t('jobs.form.experience')} htmlFor="exp"><Input id="exp" {...register('requiredExperience')} /></Field>
        <Field label={t('jobs.form.salary')} htmlFor="sal"><Input id="sal" {...register('salaryRange')} /></Field>
        <Field label={t('jobs.form.hiringManager')} htmlFor="hm">
          <Select id="hm" {...register('hiringManagerId')}>
            <option value="">—</option>
            {users.data?.filter((u) => u.isActive).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        </Field>
        <Field label={t('jobs.form.positions')} htmlFor="pos"><Input id="pos" type="number" min={1} {...register('positions', { valueAsNumber: true })} /></Field>
        <Field label={t('jobs.form.opening')} htmlFor="od"><Input id="od" type="date" {...register('openingDate')} /></Field>
        <Field label={t('jobs.form.closing')} htmlFor="cd"><Input id="cd" type="date" {...register('closingDate')} /></Field>
      </div>
      <Toggle id="open" checked={watch('open')} onChange={(v) => setValue('open', v)} label={t('jobs.form.statusOpen')} />
      {error ? <ErrorNote error={error} /> : null}
      <Button type="submit" variant="primary" loading={formState.isSubmitting}>{submitLabel}</Button>
    </form>
  );
}

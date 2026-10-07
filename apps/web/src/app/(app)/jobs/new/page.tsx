'use client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/i18n';
import { post } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { JobForm, toJobPayload } from '@/components/job-form';

export default function NewJob() {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <>
      <PageHeader title={t('jobs.new')} />
      <JobForm
        submitLabel={t('common.create')}
        onSubmit={async (v) => {
          const j = await post('/jobs', toJobPayload(v));
          await qc.invalidateQueries({ queryKey: ['jobs'] });
          router.push(`/jobs/${j.id}?tab=competencies`);
        }}
      />
    </>
  );
}

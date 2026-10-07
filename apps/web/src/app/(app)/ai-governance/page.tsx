'use client';
import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n, type MessageKey } from '@/i18n';
import { get } from '@/lib/api';
import { fmtDate, fmtNum } from '@/lib/format';
import { Badge, ErrorNote, Loading, PageHeader, Section } from '@/components/ui';

export default function Governance() {
  const { t, locale } = useI18n();
  const q = useQuery({ queryKey: ['governance'], queryFn: () => get('/ai-governance') });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const g = q.data;
  return (
    <>
      <PageHeader title={t('gov.title')} />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Section title={t('gov.principles')}>
            <ul className="space-y-2 text-sm">{g.principles.map((p: string) => <li key={p} className="border-s-2 border-brand ps-3">{p}</li>)}</ul>
          </Section>
          <Section title={t('gov.prompts')}>
            <ul className="divide-y divide-line">
              {g.prompts.map((p: any) => (
                <li key={p.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><code className="font-medium">{p.id}</code><Badge>{t('gov.version')} {p.version}</Badge><Badge tone="brand">{p.tier}</Badge></div>
                  <p className="mt-1 text-muted">{p.purpose}</p>
                  <p className="mt-1 text-xs text-muted">temperature {p.temperature}, max {p.maxTokens} tokens — {p.owner} — {p.approvedAt}</p>
                </li>
              ))}
            </ul>
          </Section>
          <Section title={t('gov.runs')}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-muted"><tr><th className="px-2 py-2 text-start font-medium">{t('gov.when')}</th><th className="px-2 py-2 text-start font-medium">{t('gov.purpose')}</th><th className="px-2 py-2 text-start font-medium">{t('gov.model')}</th><th className="px-2 py-2 text-start font-medium">{t('gov.tokens')}</th><th className="px-2 py-2 text-start font-medium">{t('gov.latency')}</th><th className="px-2 py-2 text-start font-medium">{t('common.status')}</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {g.recentRuns.map((r: any) => (
                    <tr key={r.id}><td className="tnum whitespace-nowrap px-2 py-2">{fmtDate(r.createdAt, locale)}</td><td className="px-2 py-2">{r.purpose} <span className="text-muted">v{r.promptVersion}</span></td><td className="px-2 py-2">{r.model}</td><td className="tnum px-2 py-2">{fmtNum(r.inputTokens + r.outputTokens, locale)}</td><td className="tnum px-2 py-2">{fmtNum(r.latencyMs, locale)} ms</td><td className="px-2 py-2"><Badge tone={r.status === 'SUCCEEDED' ? 'valid' : 'gap'}>{r.status}</Badge></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
        <div className="space-y-6">
          <Section title={t('gov.provider')}>
            <dl className="space-y-2 text-sm">
              <div><dt className="text-muted">{t('gov.provider')}</dt><dd className="font-medium">{g.provider.vendor} ({g.provider.active})</dd></div>
              <div><dt className="text-muted">{t('gov.location')}</dt><dd>{g.provider.processingLocation}</dd></div>
            </dl>
          </Section>
          <Section title={t('gov.models')}>
            <ul className="space-y-3 text-sm">{g.models.map((m: any) => <li key={m.tier}><code className="font-medium">{m.model}</code> <Badge>{m.tier}</Badge><p className="text-muted">{m.usedFor.join(', ')}</p></li>)}</ul>
          </Section>
          <Section title={t('gov.content')}>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
              <dt>{t('comp.title')} — {t('common.aiGenerated')}</dt><dd className="tnum">{g.content.competencies.aiGeneratedPendingApproval}</dd>
              <dt>{t('comp.title')} — {t('common.aiApproved')}</dt><dd className="tnum">{g.content.competencies.aiApprovedByHuman}</dd>
              <dt>{t('plan.title')} — {t('common.aiGenerated')}</dt><dd className="tnum">{g.content.plans.aiGeneratedPendingApproval}</dd>
              <dt>{t('plan.title')} — {t('common.aiApproved')}</dt><dd className="tnum">{g.content.plans.aiApprovedByHuman}</dd>
              {g.content.evidence.map((e: any) => (<Fragment key={e.status}><dt>{t('room.evidence')} — {t(`ev.${e.status}` as MessageKey)}</dt><dd className="tnum">{e.count}</dd></Fragment>))}
            </dl>
          </Section>
          <Section title={t('gov.retention')}>
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt>{t('set.retention.recordings')}</dt><dd className="tnum">{g.retention.recordingsDays}</dd>
              <dt>{t('set.retention.transcripts')}</dt><dd className="tnum">{g.retention.transcriptsDays}</dd>
              <dt>{t('set.retention.candidates')}</dt><dd className="tnum">{g.retention.candidatesDays}</dd>
              <dt>{t('set.retention.audit')}</dt><dd className="tnum">{g.retention.auditDays}</dd>
            </dl>
          </Section>
        </div>
      </div>
    </>
  );
}

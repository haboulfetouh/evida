'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '@/i18n';
import { fmtNum, fmtTs } from '@/lib/format';
import { CoverageStatus, EvidenceMeter } from './evidence-meter';
import { Badge, cx } from './ui';

/**
 * Evidence profile: per competency, the score sits next to the evidence it rests on.
 * Clicking a competency reveals the validated excerpts (and, separately, AI detections awaiting review).
 * A score is never shown without its evidence count, quality and coverage.
 */
export function EvidenceProfile({ profile }: { profile: any }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div><span className="text-sm text-muted">{t('sc.score')}</span> <span className="tnum text-2xl font-semibold">{profile.overallScore == null ? '—' : `${fmtNum(profile.overallScore, locale, 1)} / 5`}</span></div>
        <div><span className="text-sm text-muted">{t('room.coverage')}</span> <span className="tnum text-2xl font-semibold">{fmtNum(profile.coverage.overall * 100, locale)}%</span></div>
      </div>
      <ul className="divide-y divide-line border-y border-line">
        {profile.competencies.map((c: any) => {
          const isOpen = open === c.competencyId;
          return (
            <li key={c.competencyId}>
              <button className="grid w-full grid-cols-[1fr_auto] items-center gap-3 py-3 text-start sm:grid-cols-[1.4fr_auto_auto_auto]" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.competencyId)}>
                <span className="min-w-0">
                  <span className="block font-medium">{c.name}</span>
                  <CoverageStatus status={c.status} />
                </span>
                <span className="tnum whitespace-nowrap text-end text-lg font-semibold sm:min-w-20">{c.score == null ? <span className="font-normal text-muted">—</span> : `${fmtNum(c.score, locale, 1)}`}</span>
                <span className="hidden sm:block"><EvidenceMeter validated={c.validated.length} pending={c.pending.length} /></span>
                <ChevronDown className={cx('hidden h-4 w-4 text-muted transition-transform sm:block', isOpen && 'rotate-180')} aria-hidden />
              </button>
              {isOpen && (
                <div className="space-y-3 pb-4 ps-1">
                  <p className="text-xs text-muted">
                    {c.validated.length} {t('meter.validated')} — {t('ev.confidence')}: {t(c.confidence === 'HIGH' ? 'conf.high' : c.confidence === 'MEDIUM' ? 'conf.medium' : 'conf.low')}
                    {c.scoreCount > 1 && <> — {t('dec.variance')} {fmtNum(c.variance, locale, 2)}</>}
                  </p>
                  {c.validated.map((e: any) => <Excerpt key={e.id} e={e} />)}
                  {c.pending.length > 0 && (
                    <div className="space-y-2 border-s-2 border-pending/50 ps-3">
                      <p className="text-xs font-medium text-pending">{t('ev.AI_DETECTED')} — {t('meter.pending')}</p>
                      {c.pending.map((e: any) => <Excerpt key={e.id} e={e} />)}
                    </div>
                  )}
                  {!c.validated.length && !c.pending.length && <p className="text-sm text-gap">{t('meter.missing')}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Excerpt({ e }: { e: any }) {
  const { t } = useI18n();
  return (
    <figure className="text-sm">
      <blockquote className="border-s-2 border-line ps-3">“{e.quote}”</blockquote>
      <figcaption className="mt-1 flex flex-wrap items-center gap-2 ps-3 text-xs text-muted">
        <span>{e.summary}</span>
        {e.timestampSec != null && <span className="tnum">{fmtTs(e.timestampSec)}</span>}
        {e.stageName && <span>{e.stageName}</span>}
        {e.type === 'INFERRED' && <Badge tone="pending">{t('ev.inferred')}</Badge>}
        {e.polarity === 'negative' && <Badge tone="gap">{t('ev.negative')}</Badge>}
      </figcaption>
    </figure>
  );
}

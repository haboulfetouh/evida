'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Sparkles } from 'lucide-react';
import { useI18n, type MessageKey } from '@/i18n';
import { api, del, get, patch, post, waitForJob } from '@/lib/api';
import { useCan } from '@/lib/session';
import { fmtDate, fmtNum } from '@/lib/format';
import { EvidenceProfile } from '@/components/evidence-profile';
import { Badge, Button, ErrorNote, Loading, PageHeader, Section, Select } from '@/components/ui';

function ApplicationBlock({ app, candidate, onChange }: { app: any; candidate: any; onChange: () => void }) {
  const { t, locale } = useI18n();
  const can = useCan();
  const profile = useQuery({ queryKey: ['profile', app.id], queryFn: () => get(`/applications/${app.id}/evidence-profile`), enabled: can('evidence.read') });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cv = profile.data?.cvAnalysis?.applicationId === app.id ? profile.data.cvAnalysis : null;
  const manual = ['APPLIED', 'SCREENING', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'ASSESSMENT', 'FINAL_INTERVIEW', 'ON_HOLD', 'WITHDRAWN'];
  return (
    <Section
      title={<span className="flex flex-wrap items-center gap-2"><Link className="hover:underline" href={`/jobs/${app.job.id}`}>{app.job.title}</Link><Badge tone="brand">{t(`stage.${app.stage}` as MessageKey)}</Badge></span>}
      actions={
        <>
          {can('candidate.update') && (
            <Select aria-label={t('cand.moveStage')} className="h-8 w-48 text-sm" value="" onChange={async (e) => {
              if (!e.target.value) return;
              try { await patch(`/applications/${app.id}/stage`, { stage: e.target.value }); onChange(); } catch (err) { setError(err); }
            }}>
              <option value="">{t('cand.moveStage')}</option>
              {manual.filter((s) => s !== app.stage).map((s) => <option key={s} value={s}>{t(`stage.${s}` as MessageKey)}</option>)}
            </Select>
          )}
          {can('interview.create') && <Link href={`/interviews/new?applicationId=${app.id}`}><Button size="sm">{t('cand.schedule')}</Button></Link>}
          {can('decision.read') && <Link href={`/applications/${app.id}/decision`}><Button size="sm" variant="primary">{t('cand.decision')}</Button></Link>}
        </>
      }
    >
      {error ? <div className="mb-3"><ErrorNote error={error} /></div> : null}
      {can('evidence.read') && (
        <div className="mb-6">
          <h3 className="mb-3 text-sm font-semibold">{t('cand.evidenceProfile')}</h3>
          {profile.isLoading ? <Loading /> : profile.data ? <EvidenceProfile profile={profile.data} /> : null}
        </div>
      )}
      {profile.data?.interviews?.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-semibold">{t('cand.interviews')}</h3>
          <ul className="divide-y divide-line text-sm">
            {profile.data.interviews.map((i: any) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/interviews/${i.id}`} className="hover:underline">{i.stage}</Link>
                <span className="flex items-center gap-2 text-muted"><span className="tnum">{fmtDate(i.scheduledAt, locale)}</span><Badge>{t(`iv.status.${i.status}` as MessageKey)}</Badge></span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {candidate.cv && can('candidate.update') && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('cand.cvAnalysis')}</h3>
            <Button size="sm" loading={busy} onClick={async () => {
              setBusy(true); setError(null);
              try { const r = await post(`/applications/${app.id}/cv-analysis`); await waitForJob(r.queue, r.queueJobId); await profile.refetch(); } catch (e) { setError(e); } finally { setBusy(false); }
            }}><Sparkles className="h-4 w-4" />{busy ? t('cand.analyzing') : t('cand.analyzeCv')}</Button>
          </div>
          {cv && (
            <div className="space-y-3 text-sm">
              <p className="text-xs text-pending">{t('cand.cvNote')}</p>
              <ul className="divide-y divide-line">
                {cv.jobFit.map((f: any) => (
                  <li key={f.competencyKey} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{profile.data.competencies.find((c: any) => c.key === f.competencyKey)?.name ?? f.competencyKey}</span>
                      <Badge tone={f.status === 'EVIDENCE_FOUND' ? 'valid' : f.status === 'PARTIAL' ? 'pending' : 'gap'}>{f.status === 'INSUFFICIENT_EVIDENCE' ? t('meter.missing') : f.status === 'PARTIAL' ? t('meter.partial') : t('meter.sufficient')}</Badge>
                    </div>
                    {f.evidenceFound.length > 0 && <ul className="mt-1 list-disc ps-5 text-muted">{f.evidenceFound.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>}
                    {f.evidenceMissing && <p className="mt-1 text-gap">{f.evidenceMissing}</p>}
                  </li>
                ))}
              </ul>
              {cv.potentialInconsistencies.length > 0 && <div><p className="font-medium">{t('cand.inconsistencies')}</p><ul className="list-disc ps-5">{cv.potentialInconsistencies.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>}
              {cv.suggestedProbes.length > 0 && <div><p className="font-medium">{t('cand.probes')}</p><ul className="list-disc ps-5">{cv.suggestedProbes.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

export default function CandidatePage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const can = useCan();
  const router = useRouter();
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ['candidate', id], queryFn: () => get(`/candidates/${id}`) });
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (c.isLoading) return <Loading />;
  if (c.error) return <ErrorNote error={c.error} />;
  const x = c.data;

  return (
    <>
      <PageHeader
        back={<Link href="/candidates" className="mb-2 inline-block text-sm text-muted hover:text-ink">{t('cand.title')}</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{x.name}{x.isSynthetic && <Badge tone="pending">{t('common.synthetic')}</Badge>}</span>}
        subtitle={[x.currentPosition, x.currentCompany, x.location, x.yearsExperience != null ? `${fmtNum(x.yearsExperience, locale)} y` : null].filter(Boolean).join(', ')}
        actions={
          <>
            {x.cv && can('cv.download') && <Button onClick={async () => { try { const r = await get(`/candidates/${id}/cv/download`); window.location.href = r.url; } catch (e) { setError(e); } }}><Download className="h-4 w-4" />{t('cand.downloadCv')}</Button>}
            {can('candidate.update') && (
              <>
                <input ref={file} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setUploading(true); setError(null);
                  const fd = new FormData();
                  fd.append('file', f);
                  try { await api(`/candidates/${id}/cv`, { method: 'POST', body: fd }); await c.refetch(); } catch (err) { setError(err); } finally { setUploading(false); e.target.value = ''; }
                }} />
                <Button onClick={() => file.current?.click()} loading={uploading} title={t('cand.cvHint')}><FileUp className="h-4 w-4" />{uploading ? t('cand.uploading') : t('cand.uploadCv')}</Button>
              </>
            )}
          </>
        }
      />
      {x.blind && <p className="mb-4"><Badge tone="brand">{t('cand.blind')}</Badge></p>}
      {error ? <div className="mb-4"><ErrorNote error={error} /></div> : null}
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          {x.applications.map((a: any) => <ApplicationBlock key={a.id} app={a} candidate={x} onChange={() => c.refetch()} />)}
        </div>
        <div className="space-y-6">
          <Section>
            <dl className="space-y-3 text-sm">
              {[
                [t('common.email'), x.email], [t('cand.form.phone'), x.phone], [t('cand.form.linkedin'), x.linkedinUrl], [t('cand.form.source'), x.source],
                [t('cand.form.notice'), x.noticePeriod], [t('cand.form.salary'), x.salaryExpectation],
              ].filter(([, v]) => v).map(([k, v]) => <div key={k as string}><dt className="text-muted">{k}</dt><dd className="break-words">{v}</dd></div>)}
              {x.skills?.length > 0 && <div><dt className="text-muted">{t('jobs.form.requiredSkills')}</dt><dd className="mt-1 flex flex-wrap gap-1">{x.skills.map((s: string) => <Badge key={s}>{s}</Badge>)}</dd></div>}
              {x.recruiterNotes && <div><dt className="text-muted">{t('cand.form.notes')}</dt><dd className="whitespace-pre-line">{x.recruiterNotes}</dd></div>}
              {x.cv && <div><dt className="text-muted">CV</dt><dd>{x.cv.originalName} <span className="text-muted">({Math.round(x.cv.sizeBytes / 1024)} KB)</span></dd></div>}
            </dl>
          </Section>
          {can('candidate.update') && (
            <Section>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={async () => {
                  const data = await get(`/candidates/${id}/export`);
                  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
                  const a = document.createElement('a'); a.href = url; a.download = `candidate-${id}.json`; a.click(); URL.revokeObjectURL(url);
                }}>{t('cand.export')}</Button>
                <Button size="sm" variant="danger" onClick={async () => {
                  if (!confirm(t('cand.eraseConfirm'))) return;
                  await del(`/candidates/${id}`);
                  await qc.invalidateQueries({ queryKey: ['candidates'] });
                  router.replace('/candidates');
                }}>{t('cand.erase')}</Button>
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

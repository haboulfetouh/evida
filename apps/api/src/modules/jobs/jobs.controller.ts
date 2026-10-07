import { Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AccessService } from '../../common/access.service';
import { CurrentUser, Requires } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { Principal } from '../../common/context';
import { enqueue, QUEUES } from '../../infra/queues';
import { CandidateStage, JobStatus } from '../../db';

const JobDto = z.object({
  title: z.string().trim().min(2).max(160),
  department: z.string().max(120).nullish(),
  location: z.string().max(120).nullish(),
  employmentType: z.string().max(60).nullish(),
  description: z.string().min(20).max(20_000),
  requiredExperience: z.string().max(200).nullish(),
  requiredSkills: z.array(z.string().max(80)).max(40).default([]),
  preferredSkills: z.array(z.string().max(80)).max(40).default([]),
  salaryRange: z.string().max(120).nullish(),
  hiringManagerId: z.string().uuid().nullish(),
  recruiterId: z.string().uuid().nullish(),
  openingDate: z.coerce.date().nullish(),
  closingDate: z.coerce.date().nullish(),
  positions: z.number().int().min(1).max(500).default(1),
  status: z.nativeEnum(JobStatus).optional(),
});
const JobPatchDto = JobDto.partial().extend({ version: z.number().int() });

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly access: AccessService) {}

  @Get()
  @Requires('job.read')
  async list(@CurrentUser() u: Principal, @Query('status') status?: JobStatus) {
    const jobs = await this.prisma.job.findMany({
      where: { organizationId: u.organizationId, deletedAt: null, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { applications: true, competencies: true } } },
    });
    const interviews = await this.prisma.interview.groupBy({
      by: ['applicationId'],
      where: { organizationId: u.organizationId },
      _count: true,
    });
    const appJob = await this.prisma.application.findMany({ where: { organizationId: u.organizationId }, select: { id: true, jobId: true } });
    const jobOf = new Map(appJob.map((a) => [a.id, a.jobId]));
    const ivCount = new Map<string, number>();
    for (const g of interviews) ivCount.set(jobOf.get(g.applicationId)!, (ivCount.get(jobOf.get(g.applicationId)!) ?? 0) + g._count);
    return jobs.map((j) => ({ ...j, candidateCount: j._count.applications, competencyCount: j._count.competencies, interviewCount: ivCount.get(j.id) ?? 0 }));
  }

  @Post()
  @Requires('job.write')
  async create(@CurrentUser() u: Principal, @Body(new ZodPipe(JobDto)) dto: z.infer<typeof JobDto>) {
    await this.assertUsers(u.organizationId, [dto.hiringManagerId, dto.recruiterId]);
    const job = await this.prisma.job.create({ data: { ...dto, organizationId: u.organizationId, recruiterId: dto.recruiterId ?? u.userId } });
    await this.audit.log({ action: 'job.create', resourceType: 'job', resourceId: job.id });
    return job;
  }

  @Get(':id')
  @Requires('job.read')
  async get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const job = await this.prisma.job.findFirst({
      where: { id, organizationId: u.organizationId, deletedAt: null },
      include: {
        competencies: { orderBy: { createdAt: 'asc' }, include: { questions: { orderBy: { order: 'asc' } } } },
        plans: { orderBy: { createdAt: 'desc' }, include: { stages: { orderBy: { order: 'asc' } } } },
      },
    });
    if (!job) throw new NotFoundException({ code: 'NOT_FOUND' });
    return job;
  }

  /** Job dashboard: pipeline funnel (share of candidates that reached each stage). */
  @Get(':id/dashboard')
  @Requires('job.read')
  async dashboard(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.job(u.organizationId, id);
    const apps = await this.prisma.application.findMany({ where: { jobId: id, organizationId: u.organizationId }, select: { stage: true } });
    const interviews = await this.prisma.interview.count({ where: { application: { jobId: id } } });
    const order: CandidateStage[] = ['APPLIED', 'SCREENING', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'ASSESSMENT', 'FINAL_INTERVIEW', 'OFFER', 'HIRED'];
    const rank = (s: CandidateStage) => order.indexOf(s);
    const total = apps.length || 1;
    const reached = (s: CandidateStage) => apps.filter((a) => rank(a.stage) >= rank(s)).length;
    return {
      candidates: apps.length,
      interviews,
      finalists: apps.filter((a) => rank(a.stage) >= rank('FINAL_INTERVIEW')).length,
      offers: apps.filter((a) => a.stage === 'OFFER' || a.stage === 'HIRED').length,
      funnel: [
        { stage: 'Application', pct: apps.length ? 100 : 0 },
        { stage: 'Screening', pct: Math.round((reached('SCREENING') / total) * 100) },
        { stage: 'Interview', pct: Math.round((reached('INTERVIEW_SCHEDULED') / total) * 100) },
        { stage: 'Final', pct: Math.round((reached('FINAL_INTERVIEW') / total) * 100) },
      ],
      byStage: Object.fromEntries(Object.values(CandidateStage).map((s) => [s, apps.filter((a) => a.stage === s).length])),
    };
  }

  /** Optimistic locking: the client sends the version it edited; a stale write is rejected. */
  @Patch(':id')
  @Requires('job.write')
  async update(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(JobPatchDto)) dto: z.infer<typeof JobPatchDto>) {
    await this.access.job(u.organizationId, id);
    await this.assertUsers(u.organizationId, [dto.hiringManagerId, dto.recruiterId]);
    const { version, ...data } = dto;
    const res = await this.prisma.job.updateMany({ where: { id, organizationId: u.organizationId, version }, data: { ...data, version: { increment: 1 } } });
    if (!res.count) throw new ConflictException({ code: 'STALE_VERSION', message: 'This job was changed by someone else. Reload and try again.' });
    await this.audit.log({ action: 'job.update', resourceType: 'job', resourceId: id, metadata: { fields: Object.keys(data) } });
    return this.prisma.job.findUniqueOrThrow({ where: { id } });
  }

  @Delete(':id')
  @Requires('job.write')
  async remove(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.job(u.organizationId, id);
    await this.prisma.job.update({ where: { id }, data: { deletedAt: new Date(), status: 'CLOSED' } });
    await this.audit.log({ action: 'job.delete', resourceType: 'job', resourceId: id });
    return { ok: true };
  }

  @Post(':id/competencies/generate')
  @Requires('competency.write')
  async generateCompetencies(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.job(u.organizationId, id);
    const job = await enqueue(QUEUES.ai, 'competency_framework', { organizationId: u.organizationId, jobId: id, requestedBy: u.userId }, `cf:${id}:${Date.now() >> 16}`);
    await this.audit.log({ action: 'ai.request', resourceType: 'job', resourceId: id, metadata: { task: 'competency_framework' } });
    return { queueJobId: job.id, queue: QUEUES.ai };
  }

  @Post(':id/plans/generate')
  @Requires('plan.write')
  async generatePlan(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.job(u.organizationId, id);
    const comps = await this.prisma.competency.count({ where: { jobId: id } });
    if (comps < 1) throw new ConflictException({ code: 'NO_COMPETENCIES', message: 'Define or generate competencies first' });
    const job = await enqueue(QUEUES.ai, 'interview_plan', { organizationId: u.organizationId, jobId: id, requestedBy: u.userId }, `ip:${id}:${Date.now() >> 16}`);
    await this.audit.log({ action: 'ai.request', resourceType: 'job', resourceId: id, metadata: { task: 'interview_plan' } });
    return { queueJobId: job.id, queue: QUEUES.ai };
  }

  private async assertUsers(orgId: string, ids: (string | null | undefined)[]) {
    const wanted = ids.filter(Boolean) as string[];
    if (!wanted.length) return;
    const n = await this.prisma.user.count({ where: { id: { in: wanted }, organizationId: orgId } });
    if (n !== new Set(wanted).size) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Assigned user not found' });
  }
}

import { Body, ConflictException, Controller, Delete, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AccessService } from '../../common/access.service';
import { CurrentUser, Requires } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { Principal } from '../../common/context';

const key = z.string().regex(/^[a-z][a-z0-9_]{1,48}$/);
const CompetencyDto = z.object({
  key,
  name: z.string().trim().min(2).max(80),
  description: z.string().min(5).max(600),
  weight: z.number().min(0.5).max(3).default(1),
  requiredLevel: z.number().int().min(1).max(5).default(3),
  evaluationCriteria: z.string().max(800).nullish(),
  indicators: z.array(z.string().max(200)).max(10).default([]),
  positiveExamples: z.array(z.string().max(240)).max(6).default([]),
  negativeExamples: z.array(z.string().max(240)).max(6).default([]),
});
const QuestionDto = z.object({
  text: z.string().min(5).max(400),
  followUps: z.array(z.string().max(300)).max(5).default([]),
  category: z.enum(['behavioral', 'situational', 'technical', 'motivational']).default('behavioral'),
  stageId: z.string().uuid().nullish(),
  order: z.number().int().min(0).default(0),
});
const ApproveDto = z.object({ ids: z.array(z.string().uuid()).optional() });

@ApiTags('competencies')
@Controller()
export class CompetenciesController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly access: AccessService) {}

  @Post('jobs/:jobId/competencies')
  @Requires('competency.write')
  async create(@CurrentUser() u: Principal, @Param('jobId', ParseUUIDPipe) jobId: string, @Body(new ZodPipe(CompetencyDto)) dto: z.infer<typeof CompetencyDto>) {
    await this.access.job(u.organizationId, jobId);
    const c = await this.prisma.competency.create({ data: { ...dto, jobId, organizationId: u.organizationId, origin: 'HUMAN' } });
    await this.audit.log({ action: 'competency.create', resourceType: 'competency', resourceId: c.id });
    return c;
  }

  /** Editing AI-generated content keeps it labelled AI_GENERATED until a human approves it. */
  @Patch('competencies/:id')
  @Requires('competency.write')
  async update(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CompetencyDto.partial())) dto: Partial<z.infer<typeof CompetencyDto>>) {
    await this.own(u, id);
    const c = await this.prisma.competency.update({ where: { id }, data: dto });
    await this.audit.log({ action: 'competency.update', resourceType: 'competency', resourceId: id, metadata: { fields: Object.keys(dto) } });
    return c;
  }

  @Delete('competencies/:id')
  @Requires('competency.write')
  async remove(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.own(u, id);
    const used = await this.prisma.evidence.count({ where: { competencyId: id } });
    if (used) throw new ConflictException({ code: 'IN_USE', message: 'This competency already has interview evidence and cannot be deleted' });
    await this.prisma.competency.delete({ where: { id } });
    await this.audit.log({ action: 'competency.delete', resourceType: 'competency', resourceId: id });
    return { ok: true };
  }

  @Post('jobs/:jobId/competencies/approve')
  @Requires('competency.approve')
  async approve(@CurrentUser() u: Principal, @Param('jobId', ParseUUIDPipe) jobId: string, @Body(new ZodPipe(ApproveDto)) dto: z.infer<typeof ApproveDto>) {
    await this.access.job(u.organizationId, jobId);
    const where = { jobId, organizationId: u.organizationId, origin: 'AI_GENERATED' as const, ...(dto.ids ? { id: { in: dto.ids } } : {}) };
    const comps = await this.prisma.competency.findMany({ where, select: { id: true } });
    const ids = comps.map((c) => c.id);
    await this.prisma.$transaction([
      this.prisma.competency.updateMany({ where: { id: { in: ids } }, data: { origin: 'AI_APPROVED', approvedById: u.userId, approvedAt: new Date() } }),
      this.prisma.question.updateMany({ where: { competencyId: { in: ids }, origin: 'AI_GENERATED' }, data: { origin: 'AI_APPROVED' } }),
    ]);
    await this.audit.log({ action: 'competency.approve', resourceType: 'job', resourceId: jobId, metadata: { count: ids.length } });
    return { approved: ids.length };
  }

  @Post('competencies/:id/questions')
  @Requires('competency.write')
  async addQuestion(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(QuestionDto)) dto: z.infer<typeof QuestionDto>) {
    const comp = await this.own(u, id);
    if (dto.stageId) await this.assertStage(u, dto.stageId, comp.jobId);
    return this.prisma.question.create({ data: { ...dto, competencyId: id, organizationId: u.organizationId, origin: 'HUMAN' } });
  }

  @Patch('questions/:id')
  @Requires('competency.write')
  async updateQuestion(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(QuestionDto.partial())) dto: Partial<z.infer<typeof QuestionDto>>) {
    const q = await this.prisma.question.findFirst({ where: { id, organizationId: u.organizationId }, include: { competency: { select: { jobId: true } } } });
    if (!q) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (dto.stageId) await this.assertStage(u, dto.stageId, q.competency.jobId);
    return this.prisma.question.update({ where: { id }, data: dto });
  }

  @Delete('questions/:id')
  @Requires('competency.write')
  async removeQuestion(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.prisma.question.deleteMany({ where: { id, organizationId: u.organizationId } });
    if (!res.count) throw new NotFoundException({ code: 'NOT_FOUND' });
    return { ok: true };
  }

  /** A question can only be scoped to a stage of a plan for the same job in the same tenant. */
  private async assertStage(u: Principal, stageId: string, jobId: string) {
    const st = await this.prisma.interviewStage.findFirst({ where: { id: stageId, organizationId: u.organizationId, plan: { jobId } } });
    if (!st) throw new NotFoundException({ code: 'STAGE_NOT_FOUND' });
  }

  private async own(u: Principal, id: string) {
    const c = await this.prisma.competency.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND' });
    return c;
  }
}

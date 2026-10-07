import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AccessService } from '../../common/access.service';
import { CurrentUser, Requires } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { Principal } from '../../common/context';

const StageDto = z.object({
  name: z.string().trim().min(2).max(80),
  durationMinutes: z.number().int().min(10).max(240),
  competencyKeys: z.array(z.string()).min(1).max(8),
});
const PlanDto = z.object({
  name: z.string().trim().min(2).max(120),
  stages: z.array(StageDto).min(1).max(8), // array order = round order (drag-and-drop reorder)
  scoringRubric: z.record(z.string(), z.string().max(300)).optional(),
});

@ApiTags('interview-plans')
@Controller()
export class PlansController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly access: AccessService) {}

  @Get('interview-plans/:id')
  @Requires('job.read')
  async get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const p = await this.prisma.interviewPlan.findFirst({ where: { id, organizationId: u.organizationId }, include: { stages: { orderBy: { order: 'asc' } } } });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND' });
    return p;
  }

  @Post('jobs/:jobId/interview-plans')
  @Requires('plan.write')
  async create(@CurrentUser() u: Principal, @Param('jobId', ParseUUIDPipe) jobId: string, @Body(new ZodPipe(PlanDto)) dto: z.infer<typeof PlanDto>) {
    await this.access.job(u.organizationId, jobId);
    await this.assertKeys(jobId, dto.stages.flatMap((s) => s.competencyKeys));
    const plan = await this.prisma.interviewPlan.create({
      data: {
        organizationId: u.organizationId, jobId, name: dto.name, origin: 'HUMAN', scoringRubric: dto.scoringRubric ?? defaultRubric,
        stages: { create: dto.stages.map((s, i) => ({ ...s, order: i, organizationId: u.organizationId })) },
      },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
    await this.audit.log({ action: 'plan.create', resourceType: 'interview_plan', resourceId: plan.id });
    return plan;
  }

  /** Replace name/stages of a DRAFT plan. Active plans are immutable (interviews reference their stages). */
  @Patch('interview-plans/:id')
  @Requires('plan.write')
  async update(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(PlanDto)) dto: z.infer<typeof PlanDto>) {
    const plan = await this.own(u, id);
    if (plan.status !== 'DRAFT') throw new ConflictException({ code: 'PLAN_LOCKED', message: 'Active plans cannot be edited. Duplicate it as a new draft.' });
    await this.assertKeys(plan.jobId, dto.stages.flatMap((s) => s.competencyKeys));
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.interviewStage.deleteMany({ where: { planId: id } });
      return tx.interviewPlan.update({
        where: { id },
        data: {
          name: dto.name, scoringRubric: dto.scoringRubric ?? (plan.scoringRubric as object), version: { increment: 1 },
          stages: { create: dto.stages.map((s, i) => ({ ...s, order: i, organizationId: u.organizationId })) },
        },
        include: { stages: { orderBy: { order: 'asc' } } },
      });
    });
    await this.audit.log({ action: 'plan.update', resourceType: 'interview_plan', resourceId: id });
    return updated;
  }

  /** Human approval activates the plan (AI drafts are never active until approved). */
  @Post('interview-plans/:id/approve')
  @Requires('plan.approve')
  async approve(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const plan = await this.own(u, id);
    const pendingComps = await this.prisma.competency.count({ where: { jobId: plan.jobId, origin: 'AI_GENERATED' } });
    if (pendingComps) throw new ConflictException({ code: 'COMPETENCIES_UNAPPROVED', message: 'Approve the AI-generated competencies before activating the plan' });
    const comps = await this.prisma.competency.findMany({ where: { jobId: plan.jobId }, select: { key: true, name: true } });
    const stages = await this.prisma.interviewStage.findMany({ where: { planId: id } });
    const covered = new Set(stages.flatMap((s) => s.competencyKeys));
    const uncovered = comps.filter((c) => !covered.has(c.key)).map((c) => c.name);
    await this.prisma.$transaction([
      this.prisma.interviewPlan.updateMany({ where: { jobId: plan.jobId, status: 'ACTIVE', NOT: { id } }, data: { status: 'ARCHIVED' } }),
      this.prisma.interviewPlan.update({
        where: { id },
        data: { status: 'ACTIVE', approvedById: u.userId, approvedAt: new Date(), origin: plan.origin === 'AI_GENERATED' ? 'AI_APPROVED' : plan.origin },
      }),
    ]);
    await this.audit.log({ action: 'plan.approve', resourceType: 'interview_plan', resourceId: id, metadata: { uncovered } });
    return { ok: true, uncoveredCompetencies: uncovered };
  }

  @Post('interview-plans/:id/duplicate')
  @Requires('plan.write')
  async duplicate(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const plan = await this.own(u, id);
    const stages = await this.prisma.interviewStage.findMany({ where: { planId: id }, orderBy: { order: 'asc' } });
    return this.prisma.interviewPlan.create({
      data: {
        organizationId: u.organizationId, jobId: plan.jobId, name: `${plan.name} (copy)`, origin: 'HUMAN', scoringRubric: plan.scoringRubric as object,
        stages: { create: stages.map((s) => ({ name: s.name, durationMinutes: s.durationMinutes, competencyKeys: s.competencyKeys, order: s.order, organizationId: u.organizationId })) },
      },
      include: { stages: { orderBy: { order: 'asc' } } },
    });
  }

  private async own(u: Principal, id: string) {
    const p = await this.prisma.interviewPlan.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!p) throw new NotFoundException({ code: 'NOT_FOUND' });
    return p;
  }

  private async assertKeys(jobId: string, keys: string[]) {
    const known = new Set((await this.prisma.competency.findMany({ where: { jobId }, select: { key: true } })).map((c) => c.key));
    const unknown = [...new Set(keys)].filter((k) => !known.has(k));
    if (unknown.length) throw new ConflictException({ code: 'UNKNOWN_COMPETENCY', message: `Unknown competencies: ${unknown.join(', ')}` });
  }
}

export const defaultRubric = {
  '1': 'No relevant evidence, or evidence contradicts the competency.',
  '2': 'Limited evidence; examples are vague, hypothetical or lack the candidate’s own contribution.',
  '3': 'Solid evidence meeting the required level with at least one concrete, specific example.',
  '4': 'Strong evidence: several specific examples with clear personal ownership and measurable outcomes.',
  '5': 'Exceptional evidence: consistent, specific, outcome-backed examples exceeding the required level.',
};

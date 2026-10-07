import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AccessService } from '../../common/access.service';
import { CurrentUser, Requires } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import type { Principal } from '../../common/context';
import { publishInterviewEvent } from '../../infra/events';

const AddDto = z.object({
  competencyId: z.string().uuid(),
  quote: z.string().trim().min(3).max(600),
  summary: z.string().trim().min(3).max(240),
  polarity: z.enum(['positive', 'negative']).default('positive'),
  timestampSec: z.number().int().min(0).nullish(),
  segmentId: z.string().uuid().nullish(),
});
const ValidateDto = z.object({
  action: z.enum(['confirm', 'reject', 'edit']),
  version: z.number().int(),
  summary: z.string().trim().min(3).max(240).optional(),
  competencyId: z.string().uuid().optional(),
  polarity: z.enum(['positive', 'negative']).optional(),
});

@ApiTags('evidence')
@Controller()
export class EvidenceController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly access: AccessService) {}

  @Get('interviews/:id/evidence')
  @Requires('evidence.read')
  async list(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.interview(u, id);
    return this.prisma.evidence.findMany({
      where: { interviewId: id },
      orderBy: [{ timestampSec: 'asc' }, { createdAt: 'asc' }],
      include: { competency: { select: { id: true, key: true, name: true } } },
    });
  }

  /** Evidence the interviewer observed directly (e.g. no transcript, or a missed statement). */
  @Post('interviews/:id/evidence')
  @Requires('evidence.approve')
  async add(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(AddDto)) dto: z.infer<typeof AddDto>) {
    const iv = await this.access.interview(u, id);
    await this.assertCompetency(iv.applicationId, dto.competencyId);
    if (dto.segmentId) {
      const seg = await this.prisma.transcriptSegment.findFirst({ where: { id: dto.segmentId, transcript: { interviewId: id } } });
      if (!seg) throw new BadRequestException({ code: 'SEGMENT_INVALID' });
    }
    const e = await this.prisma.evidence.create({
      data: {
        organizationId: u.organizationId, interviewId: id, competencyId: dto.competencyId, segmentId: dto.segmentId ?? null,
        quote: dto.quote, summary: dto.summary, speaker: 'CANDIDATE', timestampSec: dto.timestampSec ?? null,
        confidence: 1, polarity: dto.polarity, type: 'OBSERVED', status: 'HUMAN_ADDED', validatedById: u.userId, validatedAt: new Date(),
      },
    });
    await this.audit.log({ action: 'evidence.create', resourceType: 'evidence', resourceId: e.id });
    await publishInterviewEvent(u.organizationId, { type: 'evidence.updated', interviewId: id });
    return e;
  }

  /** Human validation of AI-detected evidence. Quotes stay verbatim; only summary/mapping can be edited. */
  @Patch('evidence/:id')
  @Requires('evidence.approve')
  async validate(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ValidateDto)) dto: z.infer<typeof ValidateDto>) {
    const ev = await this.prisma.evidence.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!ev) throw new NotFoundException({ code: 'NOT_FOUND' });
    const iv = await this.access.interview(u, ev.interviewId);
    if (dto.competencyId) await this.assertCompetency(iv.applicationId, dto.competencyId);
    const status = dto.action === 'confirm' ? (ev.status === 'HUMAN_ADDED' ? 'HUMAN_ADDED' : 'CONFIRMED') : dto.action === 'reject' ? 'REJECTED' : 'EDITED';
    const res = await this.prisma.evidence.updateMany({
      where: { id, version: dto.version },
      data: {
        status, validatedById: u.userId, validatedAt: new Date(), version: { increment: 1 },
        ...(dto.action === 'edit' ? { summary: dto.summary ?? ev.summary, competencyId: dto.competencyId ?? ev.competencyId, polarity: dto.polarity ?? ev.polarity } : {}),
      },
    });
    if (!res.count) throw new ConflictException({ code: 'STALE_VERSION', message: 'Another panelist updated this evidence. Refresh to see the latest.' });
    await this.audit.log({ action: 'evidence.modify', resourceType: 'evidence', resourceId: id, metadata: { action: dto.action, from: ev.status, to: status } });
    await publishInterviewEvent(u.organizationId, { type: 'evidence.updated', interviewId: ev.interviewId });
    await publishInterviewEvent(u.organizationId, { type: 'coverage.updated', interviewId: ev.interviewId });
    return this.prisma.evidence.findUniqueOrThrow({ where: { id }, include: { competency: { select: { id: true, key: true, name: true } } } });
  }

  private async assertCompetency(applicationId: string, competencyId: string) {
    const app = await this.prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    const c = await this.prisma.competency.findFirst({ where: { id: competencyId, jobId: app.jobId } });
    if (!c) throw new BadRequestException({ code: 'COMPETENCY_INVALID' });
  }
}

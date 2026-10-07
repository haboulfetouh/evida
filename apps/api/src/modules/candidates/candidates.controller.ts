import {
  BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import FileType from 'file-type';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { AccessService } from '../../common/access.service';
import { WebhookEmitter } from '../../common/webhook.emitter';
import { CurrentUser, Requires } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { sha256 } from '../../common/crypto';
import type { Principal } from '../../common/context';
import { hasOrgWideInterviewAccess, permissionsFor } from '../../common/permissions';
import { env } from '../../config';
import { putObject, signedDownloadUrl, deleteObject } from '../../infra/storage';
import { scanBuffer } from '../../infra/malware';
import { enqueue, QUEUES } from '../../infra/queues';
import { EvidenceProfileService } from '../../domain/evidence-profile.service';
import { isBlind, maskCandidate } from '../../domain/blind';
import { CandidateStage, Prisma } from '../../db';

const CandidateDto = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().email().max(200),
  phone: z.string().max(40).nullish(),
  location: z.string().max(120).nullish(),
  linkedinUrl: z.string().url().regex(/^https:\/\/([a-z]+\.)?linkedin\.com\//i, 'LinkedIn URL').nullish(),
  currentCompany: z.string().max(160).nullish(),
  currentPosition: z.string().max(160).nullish(),
  yearsExperience: z.number().min(0).max(60).nullish(),
  skills: z.array(z.string().max(80)).max(60).default([]),
  education: z.array(z.object({ degree: z.string().max(160), institution: z.string().max(160), year: z.string().max(10).nullish() })).max(10).default([]),
  source: z.string().max(80).nullish(),
  salaryExpectation: z.string().max(80).nullish(),
  noticePeriod: z.string().max(80).nullish(),
  recruiterNotes: z.string().max(5000).nullish(),
  jobId: z.string().uuid().optional(),
});
const StageDto = z.object({ stage: z.nativeEnum(CandidateStage) });
const ApplyDto = z.object({ jobId: z.string().uuid() });

const ALLOWED_CV = new Map([
  ['application/pdf', 'pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
]);

@ApiTags('candidates')
@Controller()
export class CandidatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly webhooks: WebhookEmitter,
    private readonly profiles: EvidenceProfileService,
  ) {}

  @Get('candidates')
  @Requires('candidate.read')
  async list(@CurrentUser() u: Principal, @Query('q') q?: string, @Query('jobId') jobId?: string, @Query('stage') stage?: CandidateStage) {
    let ids: string[] | undefined;
    if (q && q.trim()) {
      // PostgreSQL full-text search (GIN index candidate_fts); parameterised, never interpolated.
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Candidate"
        WHERE "organizationId" = ${u.organizationId}::uuid AND "deletedAt" IS NULL
          AND evida_candidate_search_doc("name","currentPosition","currentCompany","skills") @@ plainto_tsquery('simple', ${q.slice(0, 100)})
        LIMIT 200`;
      ids = rows.map((r) => r.id);
    }
    const where: Prisma.CandidateWhereInput = {
      organizationId: u.organizationId,
      deletedAt: null,
      ...(ids ? { id: { in: ids } } : {}),
      ...(jobId || stage ? { applications: { some: { ...(jobId ? { jobId } : {}), ...(stage ? { stage } : {}) } } } : {}),
      ...(!hasOrgWideInterviewAccess(u.roles) ? { applications: { some: { interviews: { some: { participants: { some: { userId: u.userId } } } } } } } : {}),
    };
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
    const blind = isBlind(u, org.blindReviewEnabled);
    const rows = await this.prisma.candidate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, name: true, email: true, currentPosition: true, currentCompany: true, yearsExperience: true, location: true, isSynthetic: true, createdAt: true,
        applications: { select: { id: true, stage: true, job: { select: { id: true, title: true } } } },
      },
    });
    return rows.map((c) => maskCandidate(c, blind));
  }

  @Post('candidates')
  @Requires('candidate.create')
  async create(@CurrentUser() u: Principal, @Body(new ZodPipe(CandidateDto)) dto: z.infer<typeof CandidateDto>) {
    const { jobId, ...data } = dto;
    if (jobId) await this.access.job(u.organizationId, jobId);
    const c = await this.prisma.candidate.create({
      data: { ...data, email: data.email.toLowerCase(), organizationId: u.organizationId, ...(jobId ? { applications: { create: { jobId, organizationId: u.organizationId } } } : {}) },
      include: { applications: true },
    });
    await this.audit.log({ action: 'candidate.create', resourceType: 'candidate', resourceId: c.id });
    await this.webhooks.emit(u.organizationId, 'candidate.created', { candidateId: c.id, jobId: jobId ?? null });
    return c;
  }

  @Get('candidates/:id')
  @Requires('candidate.read')
  async get(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.access.candidate(u, id);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
    const blind = isBlind(u, org.blindReviewEnabled);
    const perms = permissionsFor(u.roles);
    const orgWide = hasOrgWideInterviewAccess(u.roles);
    const applications = await this.prisma.application.findMany({
      where: {
        candidateId: id,
        organizationId: u.organizationId,
        // Users without org-wide access only see the cases they sit on.
        ...(orgWide ? {} : { interviews: { some: { participants: { some: { userId: u.userId } } } } }),
      },
      include: {
        job: { select: { id: true, title: true, department: true } },
        ...(perms.has('decision.read') ? { decisions: { orderBy: { createdAt: 'desc' as const }, take: 1 } } : {}),
      },
    });
    const cv = c.cvFileId ? await this.prisma.file.findUnique({ where: { id: c.cvFileId }, select: { id: true, originalName: true, sizeBytes: true, scanStatus: true, createdAt: true } }) : null;
    await this.audit.log({ action: 'candidate.access', resourceType: 'candidate', resourceId: id });
    // Explicit allow-list; blind review additionally hides history that identifies the person.
    const base = {
      id: c.id, name: c.name, email: c.email, phone: c.phone, location: c.location, linkedinUrl: c.linkedinUrl, currentCompany: c.currentCompany,
      currentPosition: c.currentPosition, yearsExperience: c.yearsExperience, skills: c.skills, education: c.education, source: c.source,
      salaryExpectation: c.salaryExpectation, noticePeriod: c.noticePeriod, isSynthetic: c.isSynthetic, createdAt: c.createdAt,
    };
    return blind
      ? { ...maskCandidate(base, true), currentCompany: null, education: [], source: null, noticePeriod: null, recruiterNotes: null, applications, cv: null }
      : { ...base, recruiterNotes: c.recruiterNotes, applications, cv };
  }

  @Patch('candidates/:id')
  @Requires('candidate.update')
  async update(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(CandidateDto.omit({ jobId: true }).partial())) dto: Partial<z.infer<typeof CandidateDto>>) {
    await this.access.candidate(u, id);
    const c = await this.prisma.candidate.update({ where: { id }, data: { ...dto, email: dto.email?.toLowerCase() } });
    await this.audit.log({ action: 'candidate.update', resourceType: 'candidate', resourceId: id, metadata: { fields: Object.keys(dto) } });
    await this.webhooks.emit(u.organizationId, 'candidate.updated', { candidateId: id });
    return c;
  }

  /**
   * Secure CV upload: size-limited, type checked by magic bytes (not extension or client MIME),
   * malware-scanned, stored under a random key; the original filename is metadata only.
   */
  @Post('candidates/:id/cv')
  @Requires('candidate.update')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  async uploadCv(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    await this.access.candidate(u, id);
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED' });
    if (file.size > env().MAX_UPLOAD_MB * 1024 * 1024) throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: `Maximum ${env().MAX_UPLOAD_MB} MB` });
    const detected = await FileType.fromBuffer(file.buffer);
    if (!detected || !ALLOWED_CV.has(detected.mime)) throw new BadRequestException({ code: 'FILE_TYPE', message: 'Only PDF and DOCX files are accepted' });
    const scan = await scanBuffer(file.buffer);
    if (scan === 'INFECTED') {
      await this.audit.log({ action: 'file.upload', resourceType: 'candidate', resourceId: id, result: 'DENIED', metadata: { reason: 'malware' } });
      throw new BadRequestException({ code: 'FILE_REJECTED', message: 'The file failed the security scan' });
    }
    const storageKey = `${u.organizationId}/cv/${randomUUID()}.${ALLOWED_CV.get(detected.mime)}`;
    await putObject(storageKey, file.buffer, detected.mime);
    const originalName = (file.originalname || 'cv').replace(/[^\w.\- ]+/g, '_').slice(0, 160);
    const f = await this.prisma.file.create({
      data: { organizationId: u.organizationId, storageKey, originalName, mimeType: detected.mime, sizeBytes: file.size, sha256: sha256(file.buffer), scanStatus: scan, uploadedById: u.userId },
    });
    const prev = await this.prisma.candidate.findUniqueOrThrow({ where: { id } });
    await this.prisma.candidate.update({ where: { id }, data: { cvFileId: f.id, cvAnalysis: Prisma.DbNull } });
    if (prev.cvFileId) await this.prisma.file.update({ where: { id: prev.cvFileId }, data: { deletedAt: new Date() } });
    await this.audit.log({ action: 'file.upload', resourceType: 'candidate', resourceId: id, metadata: { fileId: f.id, scan } });
    return { fileId: f.id, scanStatus: scan };
  }

  @Get('candidates/:id/cv/download')
  @Requires('cv.download')
  async downloadCv(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.access.candidate(u, id);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
    if (isBlind(u, org.blindReviewEnabled)) throw new NotFoundException({ code: 'NO_CV' });
    if (!c.cvFileId) throw new NotFoundException({ code: 'NO_CV' });
    const f = await this.prisma.file.findFirstOrThrow({ where: { id: c.cvFileId, organizationId: u.organizationId, deletedAt: null } });
    await this.audit.log({ action: 'cv.download', resourceType: 'candidate', resourceId: id, metadata: { fileId: f.id } });
    return { url: await signedDownloadUrl(f.storageKey, f.originalName), expiresInSec: 300 };
  }

  /** AI CV intelligence for a given job application (queued; never auto-rejects). */
  @Post('applications/:id/cv-analysis')
  @Requires('candidate.update')
  async analyzeCv(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const app = await this.access.application(u.organizationId, id);
    const c = await this.prisma.candidate.findUniqueOrThrow({ where: { id: app.candidateId } });
    if (!c.cvFileId) throw new BadRequestException({ code: 'NO_CV', message: 'Upload a CV first' });
    const job = await enqueue(QUEUES.candidate, 'cv_analysis', { organizationId: u.organizationId, applicationId: id }, `cv:${id}:${c.cvFileId}`);
    return { queueJobId: job.id, queue: QUEUES.candidate };
  }

  @Post('candidates/:id/applications')
  @Requires('candidate.update')
  async apply(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ApplyDto)) dto: z.infer<typeof ApplyDto>) {
    await this.access.candidate(u, id);
    await this.access.job(u.organizationId, dto.jobId);
    const app = await this.prisma.application.create({ data: { candidateId: id, jobId: dto.jobId, organizationId: u.organizationId } });
    await this.audit.log({ action: 'application.create', resourceType: 'application', resourceId: app.id });
    return app;
  }

  /** Manual pipeline moves. HIRED/REJECTED require a recorded human decision instead. */
  @Patch('applications/:id/stage')
  @Requires('candidate.update')
  async moveStage(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(StageDto)) dto: z.infer<typeof StageDto>) {
    await this.access.application(u.organizationId, id);
    if (dto.stage === 'HIRED' || dto.stage === 'REJECTED' || dto.stage === 'OFFER') {
      throw new BadRequestException({ code: 'DECISION_REQUIRED', message: 'Hire, offer and reject are recorded through the hiring decision screen' });
    }
    const app = await this.prisma.application.update({ where: { id }, data: { stage: dto.stage } });
    await this.audit.log({ action: 'application.stage_change', resourceType: 'application', resourceId: id, metadata: { stage: dto.stage } });
    return app;
  }

  @Get('applications/:id/evidence-profile')
  @Requires('evidence.read', 'candidate.read')
  async evidenceProfile(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const app = await this.access.applicationFor(u, id);
    const [profile, candidate, org] = await Promise.all([
      this.profiles.forApplication(u.organizationId, id),
      this.prisma.candidate.findUniqueOrThrow({ where: { id: app.candidateId }, select: { cvAnalysis: true } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } }),
    ]);
    return { ...profile, cvAnalysis: isBlind(u, org.blindReviewEnabled) ? null : candidate.cvAnalysis };
  }

  /** Data subject export (privacy). */
  @Get('candidates/:id/export')
  @Requires('candidate.update')
  async exportData(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.candidate(u, id);
    const data = await this.prisma.candidate.findUniqueOrThrow({
      where: { id },
      include: {
        applications: {
          include: {
            decisions: true,
            interviews: { include: { consents: true, evidence: true, feedback: true, transcript: { include: { segments: { orderBy: { seq: 'asc' } } } }, scorecards: { include: { scores: true } } } },
          },
        },
      },
    });
    await this.audit.log({ action: 'data.export', resourceType: 'candidate', resourceId: id });
    return { exportedAt: new Date().toISOString(), candidate: data };
  }

  /** Right to erasure: removes files, transcripts and personal fields; keeps anonymised decision/audit records. */
  @Delete('candidates/:id')
  @Requires('candidate.update')
  async erase(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.access.candidate(u, id);
    const files = c.cvFileId ? await this.prisma.file.findMany({ where: { organizationId: u.organizationId, id: c.cvFileId } }) : [];
    for (const f of files) {
      await deleteObject(f.storageKey).catch(() => undefined);
      await this.prisma.file.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
    }
    await this.prisma.$transaction([
      this.prisma.transcript.deleteMany({ where: { interview: { application: { candidateId: id } } } }),
      this.prisma.evidence.updateMany({ where: { interview: { application: { candidateId: id } } }, data: { quote: '[erased]', summary: '[erased]' } }),
      this.prisma.candidate.update({
        where: { id },
        data: {
          name: 'Erased candidate', email: `erased+${id}@invalid.local`, phone: null, location: null, linkedinUrl: null, currentCompany: null,
          currentPosition: null, skills: [], education: [], salaryExpectation: null, noticePeriod: null, recruiterNotes: null, cvFileId: null,
          cvAnalysis: Prisma.DbNull, deletedAt: new Date(),
        },
      }),
    ]);
    await this.audit.log({ action: 'data.delete', resourceType: 'candidate', resourceId: id });
    return { ok: true };
  }
}

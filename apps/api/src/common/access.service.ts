import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { hasOrgWideInterviewAccess } from './permissions';
import type { Principal } from './context';
import { AuditService } from './audit.service';

/**
 * Resource-level authorization. Every lookup is scoped by organizationId (tenant isolation),
 * and interviewer access is limited to interviews the user is assigned to.
 * A resource in another tenant is reported as 404, never 403, to avoid confirming existence.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async interview(user: Principal, interviewId: string) {
    const iv = await this.prisma.interview.findFirst({
      where: { id: interviewId, organizationId: user.organizationId },
      include: { participants: { select: { userId: true, isLead: true } } },
    });
    if (!iv) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Interview not found' });
    if (!hasOrgWideInterviewAccess(user.roles) && !iv.participants.some((p) => p.userId === user.userId)) {
      await this.audit.log({ action: 'interview.access', resourceType: 'interview', resourceId: interviewId, result: 'DENIED' });
      throw new ForbiddenException({ code: 'NOT_ASSIGNED', message: 'You are not assigned to this interview' });
    }
    return iv;
  }

  /** Interviewers may see a candidate only through an interview they are assigned to. */
  async candidate(user: Principal, candidateId: string) {
    const c = await this.prisma.candidate.findFirst({ where: { id: candidateId, organizationId: user.organizationId, deletedAt: null } });
    if (!c) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Candidate not found' });
    if (!hasOrgWideInterviewAccess(user.roles)) {
      const assigned = await this.prisma.interviewParticipant.count({
        where: { userId: user.userId, interview: { application: { candidateId } } },
      });
      if (!assigned) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Candidate not found' });
    }
    return c;
  }

  async job(orgId: string, jobId: string) {
    const j = await this.prisma.job.findFirst({ where: { id: jobId, organizationId: orgId, deletedAt: null } });
    if (!j) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Job not found' });
    return j;
  }

  /**
   * Application (interview case) access for a user: tenant-scoped, and for roles without org-wide
   * access (VIEWER/INTERVIEWER) only cases where the user sits on one of this application's interviews.
   */
  async applicationFor(user: Principal, applicationId: string) {
    const a = await this.application(user.organizationId, applicationId);
    if (!hasOrgWideInterviewAccess(user.roles)) {
      const assigned = await this.prisma.interviewParticipant.count({ where: { userId: user.userId, interview: { applicationId } } });
      if (!assigned) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Application not found' });
    }
    return a;
  }

  async application(orgId: string, applicationId: string) {
    const a = await this.prisma.application.findFirst({ where: { id: applicationId, organizationId: orgId } });
    if (!a) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Application not found' });
    return a;
  }
}

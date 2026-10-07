import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { NotifyService } from '../../common/notify.service';
import { CurrentUser, Requires } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { randomToken, sha256 } from '../../common/crypto';
import type { Principal } from '../../common/context';
import { env } from '../../config';
import { Role } from '../../db';
import { permissionsFor } from '../../common/permissions';
import { invalidateUserCache } from '../../common/auth.guard';
import { ForbiddenException } from '@nestjs/common';

/** No privilege escalation: a caller may only grant roles whose permissions they already hold. */
function assertCanGrant(caller: Principal, roles: Role[]) {
  const mine = permissionsFor(caller.roles);
  const over = roles.filter((r) => [...permissionsFor([r])].some((p) => !mine.has(p)));
  if (over.length) throw new ForbiddenException({ code: 'ROLE_ESCALATION', message: `You cannot grant: ${over.join(', ')}` });
}
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

const ASSIGNABLE: Role[] = ['ORG_ADMIN', 'HR_DIRECTOR', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER', 'VIEWER'];

const OrgSettingsDto = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  locale: z.enum(['en', 'ar']).optional(),
  blindReviewEnabled: z.boolean().optional(),
  recordingEnabled: z.boolean().optional(),
  aiProvider: z.enum(['anthropic', 'gemini', 'local']).optional(),
  consentPolicyVersion: z.string().max(40).optional(),
  retention: z
    .object({
      recordingsDays: z.number().int().min(1).max(3650),
      transcriptsDays: z.number().int().min(1).max(3650),
      candidatesDays: z.number().int().min(30).max(3650),
      auditDays: z.number().int().min(365).max(3650),
    })
    .optional(),
});
const InviteDto = z.object({ email: z.string().email(), name: z.string().trim().min(2).max(120), roles: z.array(z.enum(ASSIGNABLE as [Role, ...Role[]])).min(1) });
const UpdateUserDto = z.object({ roles: z.array(z.enum(ASSIGNABLE as [Role, ...Role[]])).min(1).optional(), isActive: z.boolean().optional(), name: z.string().min(2).max(120).optional() });

@ApiTags('organization')
@Controller()
export class OrgController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notify: NotifyService) {}

  @Get('organization')
  @Requires('job.read')
  get(@CurrentUser() u: Principal) {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
  }

  @Patch('organization')
  @Requires('org.manage')
  async update(@CurrentUser() u: Principal, @Body(new ZodPipe(OrgSettingsDto)) dto: z.infer<typeof OrgSettingsDto>) {
    const before = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
    const org = await this.prisma.organization.update({ where: { id: u.organizationId }, data: dto });
    const changed = Object.keys(dto).filter((k) => JSON.stringify((before as any)[k]) !== JSON.stringify((dto as any)[k]));
    await this.audit.log({ action: 'organization.config_change', resourceType: 'organization', resourceId: org.id, metadata: { changed } });
    return org;
  }

  @Get('users')
  @Requires('job.read')
  users(@CurrentUser() u: Principal) {
    return this.prisma.user.findMany({
      where: { organizationId: u.organizationId, deletedAt: null },
      select: { id: true, name: true, email: true, roles: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Admin creates a user; they receive a single-use invitation link to set a password. */
  @Post('users')
  @Requires('user.manage')
  async invite(@CurrentUser() u: Principal, @Body(new ZodPipe(InviteDto)) dto: z.infer<typeof InviteDto>) {
    assertCanGrant(u, dto.roles);
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findFirst({ where: { organizationId: u.organizationId, email } })) throw new ConflictException({ code: 'EMAIL_TAKEN', message: 'A user with this email already exists' });
    const user = await this.prisma.user.create({ data: { organizationId: u.organizationId, email, name: dto.name, roles: dto.roles } });
    const token = randomToken();
    await this.prisma.loginToken.create({ data: { userId: user.id, tokenHash: sha256(token), purpose: 'INVITE', expiresAt: new Date(Date.now() + 72 * 3600_000) } });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
    await this.notify.email({
      organizationId: u.organizationId, userId: user.id, to: email, template: 'user_invite', locale: org.locale as 'en' | 'ar',
      vars: { org: org.name, inviter: u.name, url: `${env().WEB_ORIGIN}/auth/invite?token=${encodeURIComponent(token)}` },
    });
    await this.audit.log({ action: 'user.create', resourceType: 'user', resourceId: user.id, metadata: { roles: dto.roles } });
    return { id: user.id, email: user.email, name: user.name, roles: user.roles };
  }

  @Patch('users/:id')
  @Requires('user.manage')
  async updateUser(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UpdateUserDto)) dto: z.infer<typeof UpdateUserDto>) {
    const target = await this.prisma.user.findFirst({ where: { id, organizationId: u.organizationId, deletedAt: null } });
    if (!target) throw new NotFoundException({ code: 'NOT_FOUND' });
    if (dto.roles) assertCanGrant(u, dto.roles);
    // Only organisation admins (org.manage) may change or deactivate another admin.
    if (target.roles.includes('ORG_ADMIN') && !permissionsFor(u.roles).has('org.manage')) throw new ForbiddenException({ code: 'ADMIN_PROTECTED', message: 'Only an organization admin can change an admin' });
    if (id === u.userId && (dto.isActive === false || (dto.roles && !dto.roles.includes('ORG_ADMIN') && target.roles.includes('ORG_ADMIN')))) {
      throw new BadRequestException({ code: 'SELF_LOCKOUT', message: 'You cannot remove your own admin access' });
    }
    const user = await this.prisma.user.update({ where: { id }, data: dto, select: { id: true, name: true, email: true, roles: true, isActive: true } });
    if (dto.isActive === false) await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    invalidateUserCache(id);
    await this.audit.log({ action: 'user.permission_change', resourceType: 'user', resourceId: id, metadata: { before: target.roles, after: dto.roles, isActive: dto.isActive } });
    return user;
  }

  @Delete('users/:id')
  @Requires('user.manage')
  async remove(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    if (id === u.userId) throw new BadRequestException({ code: 'SELF_DELETE' });
    const target = await this.prisma.user.findFirst({ where: { id, organizationId: u.organizationId } });
    if (target?.roles.includes('ORG_ADMIN') && !permissionsFor(u.roles).has('org.manage')) throw new ForbiddenException({ code: 'ADMIN_PROTECTED' });
    invalidateUserCache(id);
    const res = await this.prisma.user.updateMany({ where: { id, organizationId: u.organizationId, deletedAt: null }, data: { deletedAt: new Date(), isActive: false } });
    if (!res.count) throw new NotFoundException({ code: 'NOT_FOUND' });
    await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ action: 'user.delete', resourceType: 'user', resourceId: id });
    return { ok: true };
  }

  @Get('notifications')
  notifications(@CurrentUser() u: Principal) {
    return this.prisma.notification.findMany({
      where: { organizationId: u.organizationId, userId: u.userId, channel: 'IN_APP' },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  @Post('notifications/:id/read')
  async markRead(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: u.userId }, data: { status: 'READ', readAt: new Date() } });
    return { ok: true };
  }
}

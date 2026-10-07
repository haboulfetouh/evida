import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { NotifyService } from '../../common/notify.service';
import { randomToken, sha256 } from '../../common/crypto';
import { env } from '../../config';
import type { Role, User } from '../../db';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notify: NotifyService) {}

  async register(input: { organizationName: string; name: string; email: string; password: string; locale: 'en' | 'ar' }) {
    const slugBase = input.organizationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org';
    const slug = `${slugBase}-${randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const { org, user } = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: input.organizationName, slug, locale: input.locale } });
      const user = await tx.user.create({
        data: { organizationId: org.id, email: input.email.toLowerCase(), name: input.name, passwordHash, roles: ['ORG_ADMIN'] },
      });
      await this.audit.log({ action: 'organization.register', resourceType: 'organization', resourceId: org.id, organizationId: org.id, actorId: user.id, actorType: 'USER' }, tx);
      return { org, user };
    });
    return { org, tokens: await this.issue(user) };
  }

  async login(email: string, password: string, organizationSlug?: string) {
    const users = await this.prisma.user.findMany({
      where: { email: email.toLowerCase(), deletedAt: null, ...(organizationSlug ? { organization: { slug: organizationSlug } } : {}) },
      take: 2,
    });
    if (users.length > 1) throw new BadRequestException({ code: 'ORG_REQUIRED', message: 'This email belongs to several organizations; specify the organization' });
    const user = users[0];
    // Constant-ish work even for unknown users to reduce user enumeration via timing.
    if (!user || !user.passwordHash) {
      await argon2.hash(password).catch(() => undefined);
      await this.audit.log({ action: 'auth.login', resourceType: 'user', result: 'FAILURE', metadata: { reason: 'unknown_user' } });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }
    if (!user.isActive) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await this.audit.log({ action: 'auth.login', resourceType: 'user', resourceId: user.id, organizationId: user.organizationId, result: 'DENIED', metadata: { reason: 'locked' } });
      throw new UnauthorizedException({ code: 'ACCOUNT_LOCKED', message: `Too many attempts. Try again after ${LOCK_MINUTES} minutes.` });
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      });
      await this.audit.log({ action: 'auth.login', resourceType: 'user', resourceId: user.id, organizationId: user.organizationId, actorId: user.id, actorType: 'USER', result: 'FAILURE' });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await this.audit.log({ action: 'auth.login', resourceType: 'user', resourceId: user.id, organizationId: user.organizationId, actorId: user.id, actorType: 'USER' });
    return this.issue(user);
  }

  async requestMagicLink(email: string) {
    const users = await this.prisma.user.findMany({ where: { email: email.toLowerCase(), isActive: true, deletedAt: null }, include: { organization: true } });
    for (const user of users) {
      const token = randomToken();
      await this.prisma.loginToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 15 * 60_000) } });
      await this.notify.email({
        organizationId: user.organizationId, userId: user.id, to: user.email, template: 'magic_link',
        locale: (user.organization.locale as 'en' | 'ar') ?? 'en',
        vars: { url: `${env().WEB_ORIGIN}/auth/magic?token=${encodeURIComponent(token)}` },
      });
    }
    // Same response whether or not the email exists.
    return { sent: true };
  }

  /** Consumes a single-use magic-link or invitation token. Invitations may set a password. */
  async consumeLoginToken(token: string, newPassword?: string) {
    const lt = await this.prisma.loginToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!lt || lt.usedAt || lt.expiresAt < new Date()) throw new UnauthorizedException({ code: 'LINK_INVALID', message: 'This link is invalid or has expired' });
    const used = await this.prisma.loginToken.updateMany({ where: { id: lt.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new UnauthorizedException({ code: 'LINK_INVALID', message: 'This link has already been used' });
    let user = await this.prisma.user.findUniqueOrThrow({ where: { id: lt.userId } });
    if (!user.isActive || user.deletedAt) throw new UnauthorizedException({ code: 'LINK_INVALID' });
    if (lt.purpose === 'INVITE' && newPassword) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(newPassword, { type: argon2.argon2id }) } });
    }
    await this.audit.log({ action: 'auth.login', resourceType: 'user', resourceId: user.id, organizationId: user.organizationId, actorId: user.id, actorType: 'USER', metadata: { method: lt.purpose } });
    return this.issue(user);
  }

  /** Rotating refresh tokens with reuse detection: replaying a rotated token revokes the whole family. */
  async refresh(refreshToken: string | undefined): Promise<IssuedTokens> {
    if (!refreshToken) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    let claims: { sub: string; fam: string; jti: string };
    try {
      claims = jwt.verify(refreshToken, env().JWT_REFRESH_SECRET, { algorithms: ['HS256'], audience: 'evida-refresh', issuer: 'evida' }) as typeof claims;
    } catch {
      throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
    }
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!stored || stored.userId !== claims.sub) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ action: 'auth.refresh_reuse', resourceType: 'user', resourceId: stored.userId, result: 'DENIED', actorType: 'SYSTEM' });
      throw new UnauthorizedException({ code: 'TOKEN_REUSED', message: 'Session revoked, please sign in again' });
    }
    if (stored.expiresAt < new Date()) throw new UnauthorizedException({ code: 'TOKEN_EXPIRED' });
    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || !user.isActive || user.deletedAt) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
    const tokens = await this.issue(user, stored.familyId);
    const newStored = await this.prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(tokens.refreshToken) } });
    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date(), replacedBy: newStored.id } });
    return tokens;
  }

  async logout(refreshToken: string | undefined, userId?: string) {
    if (refreshToken) {
      const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
      if (stored) await this.prisma.refreshToken.updateMany({ where: { familyId: stored.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.log({ action: 'auth.logout', resourceType: 'user', resourceId: userId ?? null });
  }

  async issue(user: Pick<User, 'id' | 'organizationId' | 'roles' | 'name' | 'email'>, familyId: string = randomUUID()): Promise<IssuedTokens> {
    const e = env();
    const accessToken = jwt.sign(
      { sub: user.id, org: user.organizationId, roles: user.roles as Role[], name: user.name, email: user.email },
      e.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', expiresIn: e.JWT_ACCESS_TTL, audience: 'evida-api', issuer: 'evida' },
    );
    const refreshToken = jwt.sign({ sub: user.id, fam: familyId, jti: randomUUID() }, e.JWT_REFRESH_SECRET, {
      algorithm: 'HS256', expiresIn: e.JWT_REFRESH_TTL, audience: 'evida-refresh', issuer: 'evida',
    });
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(refreshToken), familyId, expiresAt: new Date(Date.now() + e.JWT_REFRESH_TTL * 1000) },
    });
    return { accessToken, refreshToken, csrfToken: randomToken(24) };
  }

  async ensureEmailFree(orgId: string, email: string) {
    if (await this.prisma.user.findFirst({ where: { organizationId: orgId, email: email.toLowerCase() } })) throw new ConflictException({ code: 'EMAIL_TAKEN' });
  }
}

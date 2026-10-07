import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { env } from '../config';
import { CANDIDATE_KEY, PERMS_KEY, PUBLIC_KEY } from './decorators';
import { permissionsFor, type Permission } from './permissions';
import { currentContext, type Principal } from './context';
import { PrismaService } from './prisma.service';
import { sha256 } from './crypto';
import { AuditService } from './audit.service';

export interface AccessClaims {
  sub: string;
  org: string;
  roles: Principal['roles'];
  name: string;
  email: string;
}

const USER_CACHE_MS = 10_000;
const userCache = new Map<string, { at: number; v: { isActive: boolean; deletedAt: Date | null; roles: Principal['roles']; organizationId: string } | null }>();
/** Drop a user's cached status immediately (called after role changes / deactivation in this process). */
export const invalidateUserCache = (userId: string) => userCache.delete(userId);

@Injectable()
export class AuthGuard implements CanActivate {
  private async liveUser(id: string) {
    const hit = userCache.get(id);
    if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.v;
    const v = await this.prisma.user.findUnique({ where: { id }, select: { isActive: true, deletedAt: true, roles: true, organizationId: true } });
    userCache.set(id, { at: Date.now(), v });
    if (userCache.size > 10_000) userCache.clear();
    return v;
  }

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request & { principal?: unknown }>();
    const store = currentContext();

    if (this.reflector.getAllAndOverride<boolean>(CANDIDATE_KEY, targets)) {
      const token = req.header('x-candidate-token') ?? (req.params as Record<string, string>).token;
      if (!token) throw new UnauthorizedException();
      const interview = await this.prisma.interview.findUnique({
        where: { candidateTokenHash: sha256(token) },
        select: { id: true, organizationId: true, candidateTokenExpiresAt: true, status: true },
      });
      if (!interview || !interview.candidateTokenExpiresAt || interview.candidateTokenExpiresAt < new Date()) {
        throw new UnauthorizedException({ code: 'INVITATION_INVALID', message: 'This interview link is invalid or expired' });
      }
      const principal = { kind: 'CANDIDATE' as const, interviewId: interview.id, organizationId: interview.organizationId };
      req.principal = principal;
      if (store) store.principal = principal;
      return true;
    }

    const token = req.cookies?.evida_at ?? req.header('authorization')?.replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    let claims: AccessClaims;
    try {
      claims = jwt.verify(token, env().JWT_ACCESS_SECRET, { algorithms: ['HS256'], audience: 'evida-api', issuer: 'evida' }) as AccessClaims;
    } catch {
      throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
    }
    // Roles and active status are read from the database (briefly cached), not trusted from the token,
    // so deactivation and role changes take effect within seconds rather than at token expiry.
    const live = await this.liveUser(claims.sub);
    if (!live || !live.isActive || live.deletedAt || live.organizationId !== claims.org) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
    const principal: Principal = {
      kind: 'USER',
      userId: claims.sub,
      organizationId: claims.org,
      roles: live.roles,
      name: claims.name,
      email: claims.email,
    };
    req.principal = principal;
    if (store) store.principal = principal;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMS_KEY, targets) ?? [];
    const granted = permissionsFor(principal.roles);
    const missing = required.filter((p) => !granted.has(p));
    if (missing.length) {
      await this.audit.log({ action: 'authz.denied', resourceType: 'endpoint', resourceId: req.path, result: 'DENIED', metadata: { missing } });
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Insufficient permissions' });
    }
    return true;
  }
}

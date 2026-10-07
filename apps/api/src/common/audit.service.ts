import { Injectable } from '@nestjs/common';
import { Prisma } from '../db';
import { PrismaService } from './prisma.service';
import { currentContext } from './context';
import { logger } from './logger';

export interface AuditEntry {
  action: string; // e.g. candidate.create, recording.download, decision.create
  resourceType: string;
  resourceId?: string | null;
  result?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  metadata?: Record<string, unknown>;
  organizationId?: string | null;
  actorId?: string | null;
  actorType?: 'USER' | 'CANDIDATE' | 'SYSTEM';
}

/**
 * Append-only audit trail. There is intentionally no update/delete API;
 * infra/sql/hardening.sql also installs a trigger that rejects UPDATE/DELETE on "AuditLog".
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(e: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const ctx = currentContext();
    const p = ctx?.principal;
    const data: Prisma.AuditLogUncheckedCreateInput = {
      organizationId: e.organizationId ?? p?.organizationId ?? null,
      actorId: e.actorId ?? (p?.kind === 'USER' ? p.userId : p?.kind === 'CANDIDATE' ? p.interviewId : null),
      actorType: e.actorType ?? (p?.kind ?? 'SYSTEM'),
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId ?? null,
      result: e.result ?? 'SUCCESS',
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent?.slice(0, 300),
      requestId: ctx?.requestId,
      metadata: (e.metadata as Prisma.InputJsonValue) ?? undefined,
    };
    try {
      await (tx ?? this.prisma).auditLog.create({ data });
    } catch (err) {
      // Audit failures must be visible but never leak payloads.
      logger.error({ action: e.action, err: (err as Error).message }, 'audit_write_failed');
      if (tx) throw err;
    }
  }
}

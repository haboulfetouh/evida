import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, Requires } from '../../common/decorators';
import type { Principal } from '../../common/context';
import { PROMPTS } from '../../ai/prompts';
import { env } from '../../config';
import { toCsv } from '../../domain/quality';
import { Prisma } from '../../db';

@ApiTags('governance')
@Controller()
export class GovernanceController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** AI Governance Center: providers, models, prompt versions, AI vs human-approved content, retention. */
  @Get('ai-governance')
  @Requires('ai.governance.read')
  async overview(@CurrentUser() u: Principal) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
    const [aiComps, approvedComps, aiPlans, approvedPlans, evidenceByStatus, recentRuns] = await Promise.all([
      this.prisma.competency.count({ where: { organizationId: u.organizationId, origin: 'AI_GENERATED' } }),
      this.prisma.competency.count({ where: { organizationId: u.organizationId, origin: 'AI_APPROVED' } }),
      this.prisma.interviewPlan.count({ where: { organizationId: u.organizationId, origin: 'AI_GENERATED' } }),
      this.prisma.interviewPlan.count({ where: { organizationId: u.organizationId, origin: 'AI_APPROVED' } }),
      this.prisma.evidence.groupBy({ by: ['status'], where: { organizationId: u.organizationId }, _count: true, _avg: { confidence: true } }),
      this.prisma.aIProcessingRun.findMany({ where: { organizationId: u.organizationId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    const e = env();
    return {
      provider: { active: org.aiProvider, approved: ['anthropic'], available: ['anthropic', 'gemini', 'local'], processingLocation: e.AI_PROCESSING_LOCATION, vendor: 'Anthropic (Claude)' },
      models: [
        { tier: 'reasoning', model: e.AI_MODEL_REASONING, usedFor: ['competency framework', 'interview plan', 'score suggestions', 'decision summary'] },
        { tier: 'fast', model: e.AI_MODEL_FAST, usedFor: ['CV analysis', 'evidence extraction', 'interview copilot'] },
      ],
      prompts: PROMPTS.map((p) => ({ id: p.id, version: p.version, purpose: p.purpose, owner: p.owner, tier: p.tier, temperature: p.temperature, maxTokens: p.maxTokens, createdAt: p.createdAt, approvedAt: p.approvedAt, evaluationCriteria: p.evaluationCriteria, outputSchema: p.toolName })),
      evaluation: { suite: 'test/ai-eval', version: '1.0.0' },
      content: {
        competencies: { aiGeneratedPendingApproval: aiComps, aiApprovedByHuman: approvedComps },
        plans: { aiGeneratedPendingApproval: aiPlans, aiApprovedByHuman: approvedPlans },
        evidence: evidenceByStatus.map((g) => ({ status: g.status, count: g._count, avgConfidence: g._avg.confidence ? Math.round(g._avg.confidence * 100) / 100 : null })),
      },
      retention: org.retention,
      principles: [
        'AI never makes or recommends the final hiring decision.',
        'All AI output is schema-validated; evidence must quote the transcript verbatim or it is discarded.',
        'No emotion recognition, facial analysis, accent, voice or personality inference.',
        'AI processing requires explicit candidate consent and stops on withdrawal.',
      ],
      recentRuns,
    };
  }

  @Get('audit')
  @Requires('audit.read')
  async list(
    @CurrentUser() u: Principal,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('actorId') actorId?: string,
    @Query('cursor') cursor?: string,
  ) {
    const where: Prisma.AuditLogWhereInput = {
      organizationId: u.organizationId,
      ...(action ? { action: { startsWith: action } } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(resourceId ? { resourceId } : {}),
      ...(actorId ? { actorId } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: 101, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
    await this.audit.log({ action: 'audit.read', resourceType: 'audit' });
    return {
      items: rows.slice(0, 100).map((r) => ({ ...r, actorName: actors.find((a) => a.id === r.actorId)?.name ?? (r.actorType === 'SYSTEM' ? 'System' : r.actorType === 'CANDIDATE' ? 'Candidate' : null) })),
      nextCursor: rows.length > 100 ? rows[99].id : null,
    };
  }

  @Get('reports/audit.csv')
  @Requires('audit.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="compliance-audit.csv"')
  async csv(@CurrentUser() u: Principal) {
    const rows = await this.prisma.auditLog.findMany({ where: { organizationId: u.organizationId }, orderBy: { createdAt: 'desc' }, take: 50_000 });
    await this.audit.log({ action: 'data.export', resourceType: 'report', resourceId: 'audit' });
    return toCsv(rows.map(({ metadata, ...r }) => ({ ...r, metadata })));
  }
}

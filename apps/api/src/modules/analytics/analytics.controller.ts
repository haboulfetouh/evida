import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Requires } from '../../common/decorators';
import type { Principal } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { toCsv } from '../../domain/quality';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Controller()
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService, private readonly audit: AuditService) {}

  @Get('analytics/dashboard')
  @Requires('analytics.read')
  dashboard(@CurrentUser() u: Principal) {
    return this.svc.dashboard(u.organizationId);
  }

  @Get('analytics/interview-quality')
  @Requires('analytics.read')
  quality(@CurrentUser() u: Principal) {
    return this.svc.interviewQuality(u.organizationId);
  }

  @Get('analytics/interviewers')
  @Requires('analytics.read')
  interviewers(@CurrentUser() u: Principal) {
    return this.svc.interviewers(u.organizationId);
  }

  @Get('analytics/fairness')
  @Requires('analytics.read')
  fairness(@CurrentUser() u: Principal) {
    return this.svc.fairness(u.organizationId);
  }

  @Get('analytics/ai-usage')
  @Requires('ai.governance.read')
  aiUsage(@CurrentUser() u: Principal, @Query('days') d?: string) {
    return this.svc.aiUsage(u.organizationId, Math.min(365, Math.max(1, Number(d) || 30)));
  }

  @Get('reports/interview-quality.csv')
  @Requires('analytics.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="interview-quality.csv"')
  async qualityCsv(@CurrentUser() u: Principal) {
    await this.audit.log({ action: 'data.export', resourceType: 'report', resourceId: 'interview-quality' });
    return toCsv(await this.svc.interviewQuality(u.organizationId, 5000));
  }

  @Get('reports/funnel.csv')
  @Requires('analytics.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="recruitment-funnel.csv"')
  async funnelCsv(@CurrentUser() u: Principal) {
    await this.audit.log({ action: 'data.export', resourceType: 'report', resourceId: 'funnel' });
    return toCsv((await this.svc.dashboard(u.organizationId)).funnel);
  }

  @Get('reports/interviewers.csv')
  @Requires('analytics.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="interviewer-analytics.csv"')
  async interviewersCsv(@CurrentUser() u: Principal) {
    await this.audit.log({ action: 'data.export', resourceType: 'report', resourceId: 'interviewers' });
    return toCsv((await this.svc.interviewers(u.organizationId)).map((r) => ({ ...r, interviewer: r.interviewer.name, suggestions: r.suggestions.join(' | ') })));
  }

  @Get('reports/ai-usage.csv')
  @Requires('ai.governance.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ai-usage.csv"')
  async aiCsv(@CurrentUser() u: Principal) {
    await this.audit.log({ action: 'data.export', resourceType: 'report', resourceId: 'ai-usage' });
    return toCsv((await this.svc.aiUsage(u.organizationId, 365)).byPurpose);
  }
}

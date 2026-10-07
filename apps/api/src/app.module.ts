import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './common/prisma.service';
import { AuditService } from './common/audit.service';
import { AccessService } from './common/access.service';
import { NotifyService } from './common/notify.service';
import { WebhookEmitter } from './common/webhook.emitter';
import { AuthGuard } from './common/auth.guard';
import { AllExceptionsFilter } from './common/errors.filter';
import { contextMiddleware, csrfMiddleware } from './common/middleware';
import { AiService } from './ai/ai.service';
import { EvidenceProfileService } from './domain/evidence-profile.service';
import { AuthModule } from './modules/auth/auth.module';
import { OrgController } from './modules/org/org.controller';
import { JobsController } from './modules/jobs/jobs.controller';
import { CompetenciesController } from './modules/jobs/competencies.controller';
import { PlansController } from './modules/jobs/plans.controller';
import { CandidatesController } from './modules/candidates/candidates.controller';
import { InterviewsService } from './modules/interviews/interviews.service';
import { InterviewsController } from './modules/interviews/interviews.controller';
import { RoomController } from './modules/interviews/room.controller';
import { EvidenceController } from './modules/interviews/evidence.controller';
import { ScorecardsController } from './modules/interviews/scorecards.controller';
import { DecisionsController } from './modules/decisions/decisions.controller';
import { PortalController } from './modules/portal/portal.controller';
import { AnalyticsService } from './modules/analytics/analytics.service';
import { AnalyticsController } from './modules/analytics/analytics.controller';
import { GovernanceController } from './modules/governance/governance.controller';
import { AiJobsController } from './modules/governance/ai-jobs.controller';
import { IntegrationsController } from './modules/integrations/integrations.controller';
import { HealthController } from './modules/health/health.controller';

/** Shared infrastructure available to every feature module. */
@Global()
@Module({
  providers: [PrismaService, AuditService, AccessService, NotifyService, WebhookEmitter, AiService, EvidenceProfileService, InterviewsService],
  exports: [PrismaService, AuditService, AccessService, NotifyService, WebhookEmitter, AiService, EvidenceProfileService, InterviewsService],
})
export class CoreModule {}

/**
 * EVIDA modular monolith. Feature areas are separate folders with clear boundaries;
 * they share one process, one database and one queue infrastructure (no microservices).
 */
@Module({
  imports: [CoreModule, AuthModule, ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }])],
  controllers: [
    OrgController, JobsController, CompetenciesController, PlansController, CandidatesController,
    InterviewsController, RoomController, EvidenceController, ScorecardsController, DecisionsController,
    PortalController, AnalyticsController, GovernanceController, AiJobsController, IntegrationsController, HealthController,
  ],
  providers: [
    AnalyticsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(contextMiddleware, csrfMiddleware).forRoutes('*');
  }
}

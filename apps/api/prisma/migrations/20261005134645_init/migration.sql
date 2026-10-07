-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SYSTEM_ADMIN', 'ORG_ADMIN', 'HR_DIRECTOR', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'OPEN', 'ON_HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "ContentOrigin" AS ENUM ('HUMAN', 'AI_GENERATED', 'AI_APPROVED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CandidateStage" AS ENUM ('APPLIED', 'SCREENING', 'INTERVIEW_SCHEDULED', 'INTERVIEW_COMPLETED', 'ASSESSMENT', 'FINAL_INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AIStatus" AS ENUM ('NOT_STARTED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED', 'SKIPPED_NO_CONSENT');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('RECORDING', 'TRANSCRIPTION', 'AI_ANALYSIS', 'PROFILING');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('AI_DETECTED', 'CONFIRMED', 'REJECTED', 'EDITED', 'HUMAN_ADDED');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('OBSERVED', 'INFERRED');

-- CreateEnum
CREATE TYPE "Recommendation" AS ENUM ('STRONG_HIRE', 'HIRE', 'CONSIDER', 'NO_HIRE', 'STRONG_NO_HIRE');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('HIRE', 'REJECT', 'HOLD', 'ADDITIONAL_INTERVIEW', 'OFFER');

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "blindReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiProvider" TEXT NOT NULL DEFAULT 'anthropic',
    "consentPolicyVersion" TEXT NOT NULL DEFAULT '2026-10-v1',
    "retention" JSONB NOT NULL DEFAULT '{"recordingsDays":90,"transcriptsDays":180,"candidatesDays":730,"auditDays":2555}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "roles" "Role"[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'MAGIC_LINK',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT,
    "location" TEXT,
    "employmentType" TEXT,
    "description" TEXT NOT NULL,
    "requiredExperience" TEXT,
    "requiredSkills" TEXT[],
    "preferredSkills" TEXT[],
    "salaryRange" TEXT,
    "hiringManagerId" UUID,
    "recruiterId" UUID,
    "openingDate" TIMESTAMP(3),
    "closingDate" TIMESTAMP(3),
    "positions" INTEGER NOT NULL DEFAULT 1,
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competency" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "requiredLevel" INTEGER NOT NULL DEFAULT 3,
    "evaluationCriteria" TEXT,
    "indicators" JSONB NOT NULL DEFAULT '[]',
    "positiveExamples" TEXT[],
    "negativeExamples" TEXT[],
    "origin" "ContentOrigin" NOT NULL DEFAULT 'HUMAN',
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "stageId" UUID,
    "text" TEXT NOT NULL,
    "followUps" TEXT[],
    "category" TEXT NOT NULL DEFAULT 'behavioral',
    "order" INTEGER NOT NULL DEFAULT 0,
    "origin" "ContentOrigin" NOT NULL DEFAULT 'HUMAN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewPlan" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "ContentOrigin" NOT NULL DEFAULT 'HUMAN',
    "scoringRubric" JSONB NOT NULL DEFAULT '{}',
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewStage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "competencyKeys" TEXT[],

    CONSTRAINT "InterviewStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "location" TEXT,
    "linkedinUrl" TEXT,
    "currentCompany" TEXT,
    "currentPosition" TEXT,
    "yearsExperience" DOUBLE PRECISION,
    "skills" TEXT[],
    "education" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT,
    "salaryExpectation" TEXT,
    "noticePeriod" TEXT,
    "recruiterNotes" TEXT,
    "cvFileId" UUID,
    "cvAnalysis" JSONB,
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "stage" "CandidateStage" NOT NULL DEFAULT 'APPLIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interview" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "roomName" TEXT NOT NULL,
    "recordingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiStatus" "AIStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "candidateTokenHash" TEXT,
    "candidateTokenExpiresAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Interview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewParticipant" (
    "id" UUID NOT NULL,
    "interviewId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InterviewParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewNote" (
    "id" UUID NOT NULL,
    "interviewId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "interviewId" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" UUID NOT NULL,
    "interviewId" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "language" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" UUID NOT NULL,
    "transcriptId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "speaker" TEXT NOT NULL,
    "startSec" INTEGER NOT NULL,
    "endSec" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "interviewId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "segmentId" UUID,
    "quote" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "timestampSec" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL,
    "polarity" TEXT NOT NULL DEFAULT 'positive',
    "type" "EvidenceType" NOT NULL DEFAULT 'OBSERVED',
    "status" "EvidenceStatus" NOT NULL DEFAULT 'AI_DETECTED',
    "validatedById" UUID,
    "validatedAt" TIMESTAMP(3),
    "aiRunId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scorecard" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "interviewId" UUID NOT NULL,
    "interviewerId" UUID NOT NULL,
    "recommendation" "Recommendation",
    "comments" TEXT,
    "submittedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Score" (
    "id" UUID NOT NULL,
    "scorecardId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "value" INTEGER,
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "comment" TEXT,
    "aiSuggested" INTEGER,
    "aiRationale" TEXT,
    "evidenceIds" UUID[],

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionSummary" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "aiRunId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "outcome" "DecisionOutcome" NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedById" UUID NOT NULL,
    "evidenceCoverage" DOUBLE PRECISION NOT NULL,
    "unresolvedAreas" TEXT[],
    "supersedesId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateFeedback" (
    "id" UUID NOT NULL,
    "interviewId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "structured" BOOLEAN,
    "understood" BOOLEAN,
    "respected" BOOLEAN,
    "clear" BOOLEAN,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'HIGHLY_CONFIDENTIAL',
    "scanStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIProcessingRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIProcessingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "actorId" UUID,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "title" TEXT,
    "link" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "interviewId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "durationSec" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" UUID NOT NULL,
    "webhookId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_organizationId_email_key" ON "User"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "LoginToken_tokenHash_key" ON "LoginToken"("tokenHash");

-- CreateIndex
CREATE INDEX "LoginToken_userId_idx" ON "LoginToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "Job_organizationId_status_idx" ON "Job"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Competency_organizationId_idx" ON "Competency"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Competency_jobId_key_key" ON "Competency"("jobId", "key");

-- CreateIndex
CREATE INDEX "Question_organizationId_idx" ON "Question"("organizationId");

-- CreateIndex
CREATE INDEX "InterviewPlan_organizationId_jobId_idx" ON "InterviewPlan"("organizationId", "jobId");

-- CreateIndex
CREATE INDEX "InterviewStage_planId_idx" ON "InterviewStage"("planId");

-- CreateIndex
CREATE INDEX "Candidate_organizationId_idx" ON "Candidate"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_organizationId_email_key" ON "Candidate"("organizationId", "email");

-- CreateIndex
CREATE INDEX "Application_organizationId_stage_idx" ON "Application"("organizationId", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "Application_jobId_candidateId_key" ON "Application"("jobId", "candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_roomName_key" ON "Interview"("roomName");

-- CreateIndex
CREATE UNIQUE INDEX "Interview_candidateTokenHash_key" ON "Interview"("candidateTokenHash");

-- CreateIndex
CREATE INDEX "Interview_organizationId_scheduledAt_idx" ON "Interview"("organizationId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewParticipant_interviewId_userId_key" ON "InterviewParticipant"("interviewId", "userId");

-- CreateIndex
CREATE INDEX "ConsentRecord_interviewId_type_idx" ON "ConsentRecord"("interviewId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_interviewId_key" ON "Transcript"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_transcriptId_seq_key" ON "TranscriptSegment"("transcriptId", "seq");

-- CreateIndex
CREATE INDEX "Evidence_organizationId_interviewId_idx" ON "Evidence"("organizationId", "interviewId");

-- CreateIndex
CREATE INDEX "Evidence_competencyId_idx" ON "Evidence"("competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_interviewId_interviewerId_key" ON "Scorecard"("interviewId", "interviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "Score_scorecardId_competencyId_key" ON "Score"("scorecardId", "competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionSummary_applicationId_key" ON "DecisionSummary"("applicationId");

-- CreateIndex
CREATE INDEX "Decision_organizationId_applicationId_idx" ON "Decision"("organizationId", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateFeedback_interviewId_key" ON "CandidateFeedback"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "File_storageKey_key" ON "File"("storageKey");

-- CreateIndex
CREATE INDEX "File_organizationId_idx" ON "File"("organizationId");

-- CreateIndex
CREATE INDEX "AIProcessingRun_organizationId_createdAt_idx" ON "AIProcessingRun"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AIProcessingRun_subjectType_subjectId_idx" ON "AIProcessingRun"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "Notification_organizationId_userId_status_idx" ON "Notification"("organizationId", "userId", "status");

-- CreateIndex
CREATE INDEX "Recording_organizationId_expiresAt_idx" ON "Recording"("organizationId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_webhookId_eventId_key" ON "WebhookDelivery"("webhookId", "eventId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competency" ADD CONSTRAINT "Competency_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "InterviewStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewPlan" ADD CONSTRAINT "InterviewPlan_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewStage" ADD CONSTRAINT "InterviewStage_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InterviewPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interview" ADD CONSTRAINT "Interview_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "InterviewStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewParticipant" ADD CONSTRAINT "InterviewParticipant_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewParticipant" ADD CONSTRAINT "InterviewParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewNote" ADD CONSTRAINT "InterviewNote_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "TranscriptSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_interviewerId_fkey" FOREIGN KEY ("interviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_scorecardId_fkey" FOREIGN KEY ("scorecardId") REFERENCES "Scorecard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Score" ADD CONSTRAINT "Score_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "Competency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionSummary" ADD CONSTRAINT "DecisionSummary_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateFeedback" ADD CONSTRAINT "CandidateFeedback_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIProcessingRun" ADD CONSTRAINT "AIProcessingRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

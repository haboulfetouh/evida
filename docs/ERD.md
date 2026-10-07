# Database ERD

PostgreSQL via Prisma 7 (`apps/api/prisma/schema.prisma`). UUID keys, `createdAt`/`updatedAt`, soft deletion for
users/jobs/candidates/files, optimistic `version` columns on jobs, plans, evidence and scorecards.
Database-level guarantees (migration `*_hardening`): `AuditLog` and `Decision` reject UPDATE/DELETE, score and
confidence range checks, a GIN full-text index on candidates.

```mermaid
erDiagram
  Organization ||--o{ User : has
  Organization ||--o{ Job : owns
  Organization ||--o{ Candidate : owns
  Organization ||--o{ AuditLog : records
  Organization ||--o{ AIProcessingRun : meters
  Organization ||--o{ Webhook : configures
  User ||--o{ RefreshToken : "sessions (rotated)"
  User ||--o{ LoginToken : "magic links / invites"
  Job ||--o{ Competency : defines
  Job ||--o{ InterviewPlan : "has (one ACTIVE)"
  InterviewPlan ||--o{ InterviewStage : "ordered rounds"
  Competency ||--o{ Question : "asked via"
  InterviewStage ||--o{ Question : "optionally scoped"
  Candidate ||--o{ Application : applies
  Job ||--o{ Application : receives
  Application ||--o{ Interview : "interview case"
  Application ||--o{ Decision : "immutable history"
  Application ||--o| DecisionSummary : "AI summary"
  InterviewStage ||--o{ Interview : "conducted as"
  Interview ||--o{ InterviewParticipant : panel
  User ||--o{ InterviewParticipant : sits
  Interview ||--o{ ConsentRecord : "versioned consent"
  Interview ||--o| Transcript : produces
  Transcript ||--o{ TranscriptSegment : "seq, speaker, time"
  Interview ||--o{ Evidence : yields
  Competency ||--o{ Evidence : supports
  TranscriptSegment ||--o{ Evidence : "quoted from"
  Interview ||--o{ Scorecard : "one per panelist"
  Scorecard ||--o{ Score : "per competency, evidenceIds[]"
  Interview ||--o{ InterviewNote : "private notes"
  Interview ||--o| CandidateFeedback : rated
  Interview ||--o{ Recording : "consented only"
  Webhook ||--o{ WebhookDelivery : attempts

  Evidence {
    uuid id
    uuid competencyId
    uuid segmentId
    string quote "verbatim"
    int timestampSec
    float confidence
    enum type "OBSERVED | INFERRED"
    enum status "AI_DETECTED | CONFIRMED | REJECTED | EDITED | HUMAN_ADDED"
    uuid aiRunId
    int version
  }
  Score {
    int value "1-5 or null = insufficient evidence"
    uuid_array evidenceIds
    int aiSuggested
  }
  Decision {
    enum outcome "HIRE | REJECT | HOLD | ADDITIONAL_INTERVIEW | OFFER"
    string reason
    float evidenceCoverage
    string_array unresolvedAreas
    uuid supersedesId
  }
  AuditLog {
    string action
    string resourceType
    string actorType "USER | CANDIDATE | SYSTEM"
    string requestId
    string result
  }
```

# API

REST, versioned under `/api/v1`, documented with OpenAPI 3: **`docs/openapi.json`** (regenerate with
`npm run openapi -w apps/api`; interactive docs at `/api/docs` outside production). Generate typed clients with e.g.
`npx openapi-typescript docs/openapi.json -o client.ts`.

## Authentication

| Client | Mechanism |
|---|---|
| Web app | HttpOnly `evida_at` (15 min) + `evida_rt` (14 days, rotated) cookies; state-changing requests send `X-CSRF-Token` = `evida_csrf` cookie |
| Server-to-server | `Authorization: Bearer <access token>` |
| Candidate portal | `X-Candidate-Token` (single interview, hashed at rest, expires, rotated on resend) |
| Jitsi hooks | `x-evida-timestamp` + `x-evida-signature: v1=HMAC_SHA256(secret, "<ts>.<body>")`, 5-minute window |

Errors share one envelope: `{ "code": "STALE_VERSION", "message": "...", "issues"?: [...], "requestId": "..." }`.
Optimistic locking: send the `version` you edited; a stale write returns `409 STALE_VERSION`.

## Main resources

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register · /auth/login · /auth/magic-link · /auth/magic-link/consume · /auth/refresh · /auth/logout`, `GET /auth/me` |
| Org & users | `GET/PATCH /organization`, `GET/POST /users`, `PATCH/DELETE /users/:id`, `GET /notifications` |
| Jobs | `GET/POST /jobs`, `GET/PATCH/DELETE /jobs/:id`, `GET /jobs/:id/dashboard`, `POST /jobs/:id/competencies/generate`, `POST /jobs/:id/plans/generate` |
| Competencies | `POST /jobs/:id/competencies`, `PATCH/DELETE /competencies/:id`, `POST /jobs/:id/competencies/approve`, `POST /competencies/:id/questions`, `PATCH/DELETE /questions/:id` |
| Interview plans | `GET /interview-plans/:id`, `POST /jobs/:id/interview-plans`, `PATCH /interview-plans/:id`, `POST /interview-plans/:id/approve · /duplicate` |
| Candidates | `GET/POST /candidates` (`?q=` FTS, `?jobId`, `?stage`), `GET/PATCH/DELETE /candidates/:id`, `POST /candidates/:id/cv`, `GET /candidates/:id/cv/download`, `GET /candidates/:id/export`, `POST /candidates/:id/applications` |
| Applications | `PATCH /applications/:id/stage`, `POST /applications/:id/cv-analysis`, `GET /applications/:id/evidence-profile` |
| Interviews | `GET/POST /interviews`, `GET /interviews/:id`, `PATCH /interviews/:id/reschedule`, `POST /interviews/:id/{cancel,invitation,start,complete}` |
| Interview room | `GET /interviews/:id/room`, `GET /interviews/:id/stream` (SSE), `GET /interviews/:id/coverage`, `GET/POST /interviews/:id/notes`, `GET/POST /interviews/:id/transcript`, `POST /interviews/:id/transcript/segments`, `POST /interviews/:id/copilot`, `GET /interviews/:id/recordings[/:rid/download]` |
| Evidence | `GET/POST /interviews/:id/evidence`, `PATCH /evidence/:id` (`confirm` · `reject` · `edit`) |
| Scorecards | `GET /interviews/:id/scorecard`, `PUT /scorecards/:id`, `POST /scorecards/:id/submit`, `POST /interviews/:id/score-suggestions` |
| Decisions | `GET /applications/:id/decision`, `POST /applications/:id/summary`, `POST /applications/:id/decisions` |
| Candidate portal | `GET /portal`, `POST /portal/consent`, `POST /portal/consent/withdraw`, `GET /portal/room`, `POST /portal/transcript`, `POST /portal/feedback` |
| Analytics & reports | `GET /analytics/{dashboard,interview-quality,interviewers,fairness,ai-usage}`, `GET /reports/{funnel,interview-quality,interviewers,ai-usage,audit}.csv` |
| Governance | `GET /ai-governance`, `GET /audit`, `GET /ai/jobs/:queue/:id` |
| Integrations | `GET/POST /webhooks`, `DELETE /webhooks/:id`, `POST /integrations/jitsi/events` |
| Ops (no prefix) | `GET /health/live`, `GET /health/ready`, `GET /metrics` |

## Outbound webhooks

Events: `candidate.created`, `candidate.updated`, `interview.created`, `interview.scheduled`, `interview.started`,
`interview.completed`, `transcript.ready`, `evidence.ready`, `scorecard.completed`, `decision.created`,
`candidate.hired`, `candidate.rejected`.

```http
POST <your endpoint>
x-evida-event: decision.created
x-evida-delivery: <event uuid — use for idempotency>
x-evida-timestamp: 1791230000
x-evida-signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>

{"id":"…","type":"decision.created","occurredAt":"…","organizationId":"…","data":{"applicationId":"…","decisionId":"…","outcome":"HIRE"}}
```

Verify the signature with a constant-time compare and reject timestamps older than 5 minutes. Payloads carry ids
and states only — never CV text, transcripts or evidence quotes. Failed deliveries retry 8 times with exponential
backoff, then move to the dead-letter queue (`WebhookDelivery.status = DEAD`).

# EVIDA — Evidence Driven Hiring

*Every interview. Structured. Evidenced. Decided.*

EVIDA is an interview intelligence and hiring decision platform. It turns video interviews into structured,
evidence-based hiring workflows:

**Job → Competencies → Interview Plan → Candidate → Structured Interview → Evidence → Scorecard → Decision → Audit Trail**

Video runs on Jitsi; the product is the layer around it: competency frameworks, interview guides, live evidence
coverage, evidence-linked scorecards, human decisions and a defensible audit trail. AI (Anthropic Claude) drafts,
extracts and summarises — **humans make every hiring decision**.

## What is in this repository

| Path | What it is |
|---|---|
| `apps/api` | NestJS modular monolith (REST `/api/v1`, SSE), BullMQ worker, Prisma 7 (PostgreSQL), AI provider layer |
| `apps/web` | Next.js 15 / React 19 web app (EN/AR with RTL), interviewer room with Jitsi IFrame API, candidate portal |
| `infra/` | Observability configs, Kubernetes manifests (`infra/k8s`), Jitsi recording/transcription hooks, optional RLS SQL |
| `docs/` | Architecture, ERD, API (+ `openapi.json`), security, deployment, environment, AI governance, troubleshooting |
| `.github/workflows/ci.yml` | Lint/typecheck → unit → integration → security scans → images → scan → SBOM → staging → approval → production |

## Quick start (Docker Compose)

```bash
cp .env.example .env            # set JWT_*, JITSI_APP_SECRET, and ANTHROPIC_API_KEY for AI features
docker compose up -d --build    # postgres, redis, minio, mailpit, migrate, api, worker, web
docker compose --profile video up -d     # + Jitsi (web, prosody, jicofo, jvb) with JWT auth
docker compose --profile obs up -d       # + OpenTelemetry collector, Prometheus, Tempo, Loki, Grafana
# Demo data (development only — the seed is not shipped in the production image):
npm ci && cd apps/api && DATABASE_URL=postgresql://evida:evida@localhost:15432/evida SEED_PASSWORD='choose-a-password' npm run prisma:seed
```

All host ports are custom-mapped in `docker-compose.yml` so EVIDA runs side by side with other local
projects without clashing on the usual 3000/4000/5432/6379/9000 etc.:

- Web: http://localhost:13000 · API docs (non-production): http://localhost:14000/api/docs · Mail: http://localhost:18025 · MinIO: http://localhost:19001

## Local development (without containers for the apps)

```bash
npm ci
docker compose up -d postgres redis minio minio-init mailpit   # host ports 15432/16379/19000/19001/11025/18025
cd apps/api && npx prisma generate && npm run prisma:migrate && npm run prisma:seed && cd ../..
npm run dev:api        # :4000 (set API_PORT to change)
npm run dev:worker     # :4100 (health/metrics; set WORKER_PORT to change)
npm run dev:web        # :3000 — run `npm run dev -w apps/web -- -p 13000` instead to avoid clashing
                        # with another local project that also binds :4000/:3000 directly on the host
```

The seed creates **EVIDA Demo Corporation** with clearly labelled synthetic data (users `admin@`, `recruiter@`,
`manager@`, `interviewer@demo.evida.local`, password from `SEED_PASSWORD`, default `EvidaDemo!2026` in development),
a *Senior Engineering Manager* job with six competencies, an active three-round plan, a synthetic candidate, one
completed interview with a synthetic transcript, and one upcoming interview with a printed candidate-portal link.
The seed refuses to run when `NODE_ENV=production`. No AI output is fabricated by the seed.

## Tests

```bash
npm run test:unit -w apps/api     # domain logic, hallucination guard, security primitives, AI eval harness
npm run test:e2e -w apps/api      # golden path against real Postgres + Redis (TEST_DATABASE_URL)
npm run eval:ai                    # AI evaluation against the labelled synthetic dataset (needs ANTHROPIC_API_KEY)
npm run typecheck && npm run build
```

The end-to-end suite covers: registration and invitations, AI drafts requiring human approval, scheduling,
candidate consent and secure join, live transcript → guarded evidence → human validation, coverage and copilot,
evidence-linked scorecards, AI summary with verified citations, immutable decisions, append-only audit, tenant
isolation, resource-level authorization, CSRF, refresh-token reuse detection and account lockout. AI calls in
tests use a deterministic stand-in (`test/fake-provider.ts`); production code paths never use fake AI.

## AI provider

All AI runs through the `AIProvider` interface (`apps/api/src/ai/provider.ts`). The active adapter is
**`AnthropicProvider` (Claude)**: `AI_MODEL_REASONING` (default `claude-sonnet-5-5`) for competency frameworks,
interview plans, score suggestions and decision summaries; `AI_MODEL_FAST` (default `claude-haiku-4-5-20251001`)
for CV analysis, evidence extraction and the live copilot. Structured output uses forced tool use plus Zod
validation. Gemini and local-model adapters are present as disabled placeholders so an organisation can later be
pointed at another approved provider. See `docs/AI.md`.

## Definition of Done — status

| Item | Status |
|---|---|
| Org registration, admin creates users, role assignment | Done (`/auth/register`, `/users`, invitations) |
| Jobs, competencies, AI-generated interview plan with approval | Done |
| Candidates, scheduling, invitations, secure candidate join | Done (single-interview token, rotated on resend) |
| Jitsi video, consent, recording controls | Done (JWT per participant; recording needs org + interview + consent) |
| Transcript, AI evidence extraction linked to timestamps, human validation | Done (upload, live captions, Jitsi relay) |
| Competency scores, gap detection, scorecards, hiring decision, audit | Done |
| Tenant isolation & authorization tested | Done (e2e) |
| Security controls, observability, error tracking, job monitoring | Done (see `docs/SECURITY.md`) |
| Docker deployment, Kubernetes manifests | Done |

**Phase 2 (designed for, not built):** Microsoft Entra / Google SSO, OIDC/SAML, MFA/passkeys, calendar and ATS
integrations, candidate self-scheduling, Arabic transcription models. See `docs/ARCHITECTURE.md` → Roadmap.

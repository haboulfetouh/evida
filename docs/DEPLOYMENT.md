# Deployment

## Environments

Development, testing, staging and production use **separate** databases, buckets, Redis, Jitsi deployments,
secrets and Anthropic API keys. Never copy production data to lower environments.

## Docker Compose (development / single host)

```bash
cp .env.example .env
docker compose up -d --build                 # core stack; "migrate" runs once before api/worker
docker compose --profile video up -d         # Jitsi with JWT auth (JWT_APP_ID / JWT_APP_SECRET = JITSI_APP_ID / JITSI_APP_SECRET)
docker compose --profile obs up -d           # OTel collector → Prometheus / Tempo / Loki → Grafana (:3001)
docker compose --profile scan up -d          # ClamAV; set CLAMAV_HOST=clamav
```

## Kubernetes (production)

`infra/k8s` is a kustomize base: namespace (restricted Pod Security), ConfigMap + Secret template, migration Job,
API (3+ replicas, HPA, PDB, zone spread), worker (HPA, 330 s graceful shutdown), web, TLS ingress
(`/api/v1` → API with buffering off for SSE; `/` → web), default-deny NetworkPolicies. All containers run
non-root, read-only root filesystem, no capabilities.

Release order (automated in `.github/workflows/ci.yml`): apply → wait for `job/evida-migrate` → rollout status.

Managed services: PostgreSQL 16 (with `sslmode=require`, PITR backups), Redis 7 (TLS), S3/Azure Blob (SSE-KMS,
block public access, lifecycle rule as a backstop to retention jobs), SMTP provider, secrets manager.

## Jitsi production architecture

Run Jitsi as its own subsystem (e.g. the `docker-jitsi-meet` Helm chart) — never inside EVIDA's pods:
Jitsi Meet web → Prosody (`AUTH_TYPE=jwt`, `ENABLE_GUESTS=0`) → Jicofo → autoscaled JVB pool (public UDP 10000),
optional Jibri (recording) and Jigasi (transcription).

- Token auth: `JWT_APP_ID=$JITSI_APP_ID`, `JWT_APP_SECRET=$JITSI_APP_SECRET`, `JWT_ACCEPTED_ISSUERS=evida`, `JWT_ACCEPTED_AUDIENCES=jitsi`.
- Enable lobby off / prejoin off (EVIDA handles pre-join checks); disable third-party requests and analytics.
- Recording: configure Jibri `finalize_recording_script_path` → `infra/jitsi/jibri-finalize.sh`.
- Transcription: see `infra/jitsi/transcriber-relay.md`.
- Set `NEXT_PUBLIC_JITSI_DOMAIN` at web build time and `JITSI_DOMAIN` for the API to the same host.

## Database migrations

- Standard: `npx prisma migrate deploy` (needs network access to Prisma's engine binaries).
- Locked-down builds: `node scripts/migrate-deploy.mjs` applies the same migration folders with node-postgres and
  records them in `_prisma_migrations` with identical checksums, so both tools interoperate.
- Authoring: `npx prisma migrate dev`, or offline
  `git show HEAD:apps/api/prisma/schema.prisma > /tmp/prev.prisma && npm run db:diff -- <name> --from /tmp/prev.prisma`.
- Never change production schemas by hand.

## Observability

API and worker export OTLP traces (auto-instrumented HTTP, Express, pg, ioredis); Prometheus scrapes `/metrics`
(API :4000, worker :4100 incl. `evida_jobs_total` and `evida_job_duration_seconds`); JSON logs go to Loki; Sentry
captures 5xx errors and dead-lettered jobs. Suggested alerts: API 5xx rate > 1 %, p95 latency > 500 ms, ready
probe failing, queue waiting > 100 for 10 min, dead-letter growth, AI failure rate > 5 %, AI evidence latency > 5 min.

## SLOs

API availability 99.9 %; p95 standard requests < 500 ms; dashboard p95 < 2 s; room load < 3 s excluding Jitsi;
AI evidence ready < 5 min after completion; notification delivery < 60 s; job success > 99 %.

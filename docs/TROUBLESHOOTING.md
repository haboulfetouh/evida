# Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| API exits with `Invalid environment configuration: …` | Missing/short secrets or bad URLs (keys listed, values never printed) | Set the listed variables; see `ENVIRONMENT.md` |
| `prisma generate` fails downloading `binaries.prisma.sh` | Egress blocked | Prisma 7 client needs no engine: run `PRISMA_SCHEMA_ENGINE_BINARY=/bin/false npx prisma generate`; migrate with `node scripts/migrate-deploy.mjs` |
| Login works but every write returns `403 CSRF_FAILED` | Web and API on different sites, or a proxy strips cookies | Serve both under one origin (Next rewrite or ingress path routing); check `evida_csrf` cookie is present |
| Redirect loop to `/login` | `COOKIE_SECURE=true` over plain HTTP | Use HTTPS, or `COOKIE_SECURE=false` locally |
| "Video is not available" in the room | `external_api.js` not reachable from the browser, CSP domain mismatch, self-signed cert | Open `https://<JITSI_DOMAIN>` once to trust the cert; build web with the right `NEXT_PUBLIC_JITSI_DOMAIN` |
| Jitsi says "not allowed to join" | JWT secret/app id mismatch or clock skew | Match `JWT_APP_ID`/`JWT_APP_SECRET`; sync NTP |
| Draft with AI spins then fails | Missing `ANTHROPIC_API_KEY`, invalid model id, rate limit, circuit open | Check worker logs and AI Governance → recent runs (status + error) |
| No evidence appears live | No transcript source, consent missing, `FEATURE_LIVE_COPILOT=false`, worker down | Check interview consent badges, worker `/health/ready`, queue `evidence_extraction` |
| Transcript upload: `unknownSpeakers > 0` | Speaker labels don't match candidate/panel names | Re-upload with `speakerMap` (`{"Spk1":"CANDIDATE"}`) or rename speakers |
| CV upload rejected `FILE_TYPE` | File isn't really PDF/DOCX (magic bytes) | Re-export as PDF |
| Scorecard submit `SCORECARD_INCOMPLETE` | A competency lacks a score, evidence link, or an explanation for "insufficient" | Follow the listed issues |
| Decision `GAPS_UNACKNOWLEDGED` | Hire/offer/reject with uncovered competencies | Acknowledge the gaps or choose "Additional interview" |
| `409 STALE_VERSION` | Someone saved the same record | Reload and re-apply your change |
| Webhook deliveries `DEAD` | Endpoint down, non-2xx, private IP, redirect | Fix endpoint; inspect `lastError` in Settings → Webhooks |
| Jobs stuck in `waiting` | Worker not running or Redis unreachable | Start worker; check `REDIS_URL`; inspect the `dead_letter` queue |
| e2e tests fail on schema | `TEST_DATABASE_URL` points to a DB you care about | Use a dedicated test DB — the suite drops and recreates its schema |

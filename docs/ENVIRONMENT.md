# Environment variables

Validated at boot by `apps/api/src/config.ts` (the API refuses to start with invalid config; in production it
also refuses `change-me…` secrets and non-secure cookies). `.env.example` lists every variable.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | | `development` | `development` · `test` · `staging` · `production` |
| `API_PORT` / `WORKER_PORT` | | `4000` / `4100` | Container-internal HTTP ports (worker port serves health + metrics); `docker-compose.yml` maps these to host ports `14000` / n/a to avoid clashing with other local projects |
| `WEB_ORIGIN` | ✓ prod | `http://localhost:13000` | Public URL; used in links and CORS |
| `DATABASE_URL` | ✓ | | PostgreSQL URL (`sslmode=require` in production); local Docker Compose exposes Postgres on host port `15432` |
| `DB_POOL_MAX` | | `10` | node-postgres pool size per process |
| `REDIS_URL` | ✓ | `redis://localhost:16379` | Queues and live-event pub/sub |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | ✓ | | ≥ 12 chars; use 48 random bytes |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | | `900` / `1209600` | Seconds |
| `COOKIE_SECURE` | ✓ prod | `false` | Must be `true` in production |
| `AI_PROVIDER` | | `anthropic` | Default provider for new organisations |
| `ANTHROPIC_API_KEY` | ✓ for AI | | Claude API key (separate per environment) |
| `AI_MODEL_REASONING` | | `claude-sonnet-5-5` | Plans, frameworks, score suggestions, summaries |
| `AI_MODEL_FAST` | | `claude-haiku-4-5-20251001` | CV analysis, evidence extraction, copilot |
| `AI_PRICE_*` | | 3 / 15 / 1 / 5 | USD per million tokens for cost tracking — set to your contracted prices |
| `AI_PROCESSING_LOCATION` | | `anthropic-us` | Shown to candidates and in AI governance |
| `FEATURE_LIVE_COPILOT` | | `true` | Live extraction + copilot during interviews |
| `JITSI_DOMAIN` | ✓ | `localhost:18443` | Jitsi host[:port] |
| `JITSI_APP_ID` / `JITSI_APP_SECRET` | ✓ | | Prosody JWT issuer / HS256 secret |
| `JITSI_TOKEN_TTL` | | `7200` | Seconds |
| `JITSI_WEBHOOK_SECRET` | for hooks | | HMAC secret for recording/transcription events (endpoint disabled if unset) |
| `S3_ENDPOINT` | MinIO only | | Omit for AWS S3 |
| `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | ✓ | | Object storage |
| `MAX_UPLOAD_MB` | | `10` | CV size limit |
| `CLAMAV_HOST` / `CLAMAV_PORT` | ✓ prod | / `13310` | Upload malware scanning (skipped when unset — development only) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | ✓ | Mailpit | E-mail |
| `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_SERVICE_NAME` | | | Tracing export |
| `SENTRY_DSN` | | | Error tracking |
| `LOG_LEVEL` | | `info` | Pino level |
| `DEFAULT_TZ` | | `Africa/Cairo` | Time zone used in e-mails |
| `EXPOSE_OPENAPI` | | `false` | Serve `/api/docs` in production |
| `API_INTERNAL_URL` (web) | ✓ | `http://localhost:14000` | Where the web server proxies `/api/v1` |
| `NEXT_PUBLIC_JITSI_DOMAIN` (web, build time) | ✓ | `localhost:18443` | Jitsi host for the IFrame API and CSP |
| `NEXT_PUBLIC_BROWSER_CAPTIONS` (web, build time) | | `false` | Opt-in browser speech captions |
| `SEED_PASSWORD` | | | Demo seed password (development only) |
| `TEST_DATABASE_URL` | tests | `…/evida_test` | Integration test database (wiped by the suite) |

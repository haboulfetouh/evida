# Security

Baseline: **OWASP ASVS 5.0** (Level 2 target). Candidate data (CVs, recordings, transcripts, evidence) is classified
**Highly Confidential**; job and plan content **Confidential**; analytics aggregates **Internal**.

## Controls by ASVS area

| Area | Implementation |
|---|---|
| Authentication (V6/V7) | Argon2id hashes; min 12 / max 128 chars; account lockout after 5 failures for 15 min; single-use, hashed, 15-minute magic links and 72-hour invitations; same response for unknown emails |
| Sessions (V7) | 15-minute HS256 access JWT (`aud`, `iss` checked); 14-day refresh tokens rotated on every use with **family revocation on reuse**; HttpOnly, `SameSite=Lax`, `Secure` (enforced in production) cookies; tokens never in localStorage; roles and active status re-read from the database on each request (10 s cache), so deactivation and role changes apply immediately |
| CSRF | Double-submit token (`evida_csrf` cookie ↔ `X-CSRF-Token`) on cookie-authenticated writes; HMAC-authenticated webhooks exempt |
| Authorization (V8) | Granular permissions per role (`common/permissions.ts`); no privilege escalation (callers can only grant roles whose permissions they hold; only org admins can change admins); resource-level checks (`AccessService`); interviewers and viewers see only cases they sit on; candidates only their own interview; cross-tenant ids return 404; denials audited |
| Input validation (V2) | Zod on every body (unknown keys stripped); `ParseUUIDPipe` on ids; enums; length limits |
| Output encoding / XSS | React escaping; strict CSP on web (`next.config.mjs`) and `default-src 'none'` on API; HTML e-mail values escaped |
| Injection | Prisma parameterised queries; the one raw FTS query uses tagged-template parameters |
| SSRF | Webhook URLs: HTTPS only, DNS-resolved and rejected if private/loopback/link-local (re-checked at delivery), redirects not followed, 10 s timeout |
| Files (V5) | Size cap, **magic-byte** type detection (PDF/DOCX only), ClamAV INSTREAM scan, random object keys, original filename never used as a path, private bucket, SSE, 5-minute signed download URLs, every download audited |
| Rate limiting | Global 300 req/min; auth endpoints 5–30/min; copilot 8/min; ingress rate limits |
| Headers | Helmet (HSTS in production, no `x-powered-by`, frame-ancestors none), Permissions-Policy limiting camera/mic to self + Jitsi |
| Secrets | Validated env at boot (refuses `change-me` secrets in production); secrets from a secrets manager; never logged |
| Logging | Pino with redaction of passwords, tokens, CV text, transcripts, API keys; request ids correlate logs, traces and audit |
| Audit (V16) | Append-only `AuditLog` (DB trigger rejects UPDATE/DELETE): logins, candidate/CV/transcript/recording access, evidence changes, scores, decisions, consent, exports, deletions, permission and config changes, AI processing |
| Data protection | TLS 1.2+ at ingress; encryption at rest via managed Postgres + bucket SSE; retention jobs; export and erasure endpoints; consent withdrawal stops processing and deletes unvalidated AI output / transcripts |
| Jitsi | Non-guessable room names (no interview ids); short-lived room-scoped JWT; only the lead interviewer is moderator; recording/transcription features only with policy + consent |

## AI security

- Transcripts, CVs and job descriptions are **untrusted input**, wrapped in `<untrusted_*>` tags whose own tag
  markers are stripped; system prompts instruct the model never to follow embedded instructions.
- Output only via a forced tool call validated by Zod; one corrective retry; otherwise the run fails.
- **Hallucination guard:** evidence must reference a real segment spoken by the candidate and quote it verbatim,
  for a competency of this job; score suggestions must cite evidence of the same competency; summary citations are
  verified and uncited claims dropped; hiring-decision language is refused.
- Inferred evidence is labelled and capped at 0.7 confidence; AI evidence never completes coverage on its own.
- No emotion, face, voice, accent or personality analysis; protected characteristics are never inferred.
- Prompts are tenant-scoped (one interview/application per call); provider calls carry no cross-tenant context.

## Security testing

`test/e2e/golden-path.e2e.ts` exercises tenant isolation, authorization, CSRF, token reuse, lockout, upload
type checks, HMAC verification and DB immutability. CI adds dependency audit, Gitleaks, Semgrep (OWASP Top 10),
Trivy (fs/IaC and images) and SPDX SBOMs. Before go-live: DAST (OWASP ZAP baseline against staging), external
penetration test, and the AI prompt-injection set in `test/ai-eval`.

## Reporting

Report vulnerabilities privately to the security contact of the deploying organisation; do not open public issues.

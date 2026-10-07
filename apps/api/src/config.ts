import 'dotenv/config';
import { z } from 'zod';

/** Validated environment. The app refuses to boot with a bad config (secure defaults). */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(12),
  JWT_REFRESH_SECRET: z.string().min(12),
  JWT_ACCESS_TTL: z.coerce.number().default(900),
  JWT_REFRESH_TTL: z.coerce.number().default(1209600),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  AI_PROVIDER: z.enum(['anthropic', 'gemini', 'local']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL_REASONING: z.string().default('claude-sonnet-5-5'),
  AI_MODEL_FAST: z.string().default('claude-haiku-4-5-20251001'),
  AI_PROCESSING_LOCATION: z.string().default('anthropic-us'),
  // USD per million tokens — check current Anthropic pricing and override per deployment.
  AI_PRICE_REASONING_IN: z.coerce.number().default(3),
  AI_PRICE_REASONING_OUT: z.coerce.number().default(15),
  AI_PRICE_FAST_IN: z.coerce.number().default(1),
  AI_PRICE_FAST_OUT: z.coerce.number().default(5),

  JITSI_DOMAIN: z.string().default('localhost:8443'),
  JITSI_APP_ID: z.string().default('evida'),
  JITSI_APP_SECRET: z.string().min(8),
  JITSI_TOKEN_TTL: z.coerce.number().default(7200),
  JITSI_WEBHOOK_SECRET: z.string().optional(),

  S3_ENDPOINT: z.string().optional(),
  // Browser-reachable address for presigned URLs — distinct from S3_ENDPOINT when the API
  // reaches storage over an internal/Docker address that isn't resolvable from outside.
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('evida'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().default(3310),
  MAX_UPLOAD_MB: z.coerce.number().default(10),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  MAIL_FROM: z.string().default('EVIDA <no-reply@evida.local>'),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  SENTRY_DSN: z.string().optional(),

  FEATURE_LIVE_COPILOT: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;
export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Print only keys, never values (may contain secrets).
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${keys}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JITSI_APP_SECRET'] as const) {
      if (parsed.data[k].startsWith('change-me')) throw new Error(`${k} must be set in production`);
    }
    if (!parsed.data.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
  }
  cached = parsed.data;
  return cached;
}

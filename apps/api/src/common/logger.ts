import pino from 'pino';

/**
 * Structured logger. Sensitive fields are redacted at the source: tokens, passwords,
 * CV text, transcript text and AI secrets must never reach the log pipeline.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.cvText',
      '*.transcript',
      '*.segments',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
});

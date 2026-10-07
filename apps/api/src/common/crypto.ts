import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function hmacSign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Webhook signature: HMAC-SHA256 over "<timestamp>.<body>", with replay window. */
export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return { timestamp, signature: `v1=${hmacSign(secret, `${timestamp}.${body}`)}` };
}

export function verifyWebhook(
  secret: string,
  body: string,
  timestamp: number,
  signature: string,
  toleranceSec = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > toleranceSec) return false;
  return safeEqual(signature, `v1=${hmacSign(secret, `${timestamp}.${body}`)}`);
}

import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requestContext } from './context';
import { safeEqual } from './crypto';

/** Request id + async context so audit and logs correlate with traces. */
export function contextMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', requestId);
  requestContext.run({ requestId, ip: req.ip, userAgent: req.header('user-agent') }, () => next());
}

export const CSRF_COOKIE = 'evida_csrf';

/**
 * Double-submit CSRF protection for cookie-authenticated, state-changing requests.
 * The SPA reads the non-HttpOnly evida_csrf cookie and echoes it in X-CSRF-Token.
 * Server-to-server endpoints authenticated by HMAC (webhooks) are exempt.
 */
export function csrfMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // originalUrl: inside Nest's middleware mount, req.path is relative to the mount point.
  const path = req.originalUrl.split('?')[0];
  if (path.includes('/integrations/jitsi/')) return next();
  // Pre-session auth endpoints (login, register, magic links, refresh) are exempt: they either
  // establish a session or only rotate it; SameSite=Lax cookies already block cross-site POSTs.
  if (/\/api\/v1\/auth\/(login|register|magic-link|magic-link\/consume|refresh)$/.test(path)) return next();
  const hasSession = Boolean(req.cookies?.evida_at || req.cookies?.evida_rt);
  if (!hasSession) return next(); // login/register/candidate-token flows have no session cookie yet
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.header('x-csrf-token');
  if (!cookie || !header || !safeEqual(cookie, header)) {
    return next(new ForbiddenException({ code: 'CSRF_FAILED', message: 'Missing or invalid CSRF token' }));
  }
  next();
}

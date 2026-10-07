import type { Response } from 'express';
import { env } from '../../config';
import { CSRF_COOKIE } from '../../common/middleware';
import type { IssuedTokens } from './auth.service';

/** Tokens live in HttpOnly cookies — never in localStorage. CSRF token is readable by the SPA. */
export function setAuthCookies(res: Response, t: IssuedTokens) {
  const e = env();
  const base = { secure: e.COOKIE_SECURE, sameSite: 'lax' as const };
  res.cookie('evida_at', t.accessToken, { ...base, httpOnly: true, path: '/', maxAge: e.JWT_ACCESS_TTL * 1000 });
  res.cookie('evida_rt', t.refreshToken, { ...base, httpOnly: true, path: '/api/v1/auth', maxAge: e.JWT_REFRESH_TTL * 1000 });
  res.cookie(CSRF_COOKIE, t.csrfToken, { ...base, httpOnly: false, path: '/', maxAge: e.JWT_REFRESH_TTL * 1000 });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie('evida_at', { path: '/' });
  res.clearCookie('evida_rt', { path: '/api/v1/auth' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const JITSI = process.env.NEXT_PUBLIC_JITSI_DOMAIN ?? 'localhost:8443';

// The browser talks to the API same-origin through this rewrite, so session cookies stay
// first-party (SameSite=Lax, HttpOnly) and no CORS is needed in production.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://${JITSI}${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `frame-src https://${JITSI}`,
  "connect-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export default {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  // Monorepo: trace dependencies from the workspace root so the standalone bundle is complete.
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), '../../'),
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API}/api/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Camera/mic only for this origin and the Jitsi frame.
          { key: 'Permissions-Policy', value: `camera=(self "https://${JITSI}"), microphone=(self "https://${JITSI}"), display-capture=(self "https://${JITSI}"), geolocation=()` },
        ],
      },
    ];
  },
};

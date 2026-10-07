import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config';
import { logger } from './common/logger';

/** Shared HTTP configuration for the server and the end-to-end tests. */
export function configureApp(app: NestExpressApplication) {
  const e = env();
  const http = app.getHttpAdapter().getInstance();
  http.set('trust proxy', 1);
  http.disable('x-powered-by');
  // Secure headers. The API serves JSON only, so its CSP is maximally strict.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: e.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());
  if (e.NODE_ENV !== 'test') {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false }, customProps: (req) => ({ requestId: req.headers['x-request-id'] }) }));
  }
  app.enableCors({ origin: e.WEB_ORIGIN.split(','), credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['content-type', 'x-csrf-token', 'x-candidate-token', 'x-request-id'] });
  app.useBodyParser('json', { limit: '3mb' });
  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health/(.*)', method: RequestMethod.GET }, { path: 'metrics', method: RequestMethod.GET }] });
  return app;
}

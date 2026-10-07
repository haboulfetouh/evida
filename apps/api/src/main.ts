import './telemetry';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { env } from './config';
import { logger } from './common/logger';
import { closeQueues } from './infra/queues';

async function bootstrap() {
  const e = env();
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: true, logger: ['error', 'warn', 'log'] }));
  app.enableShutdownHooks();

  if (e.NODE_ENV !== 'production' || process.env.EXPOSE_OPENAPI === 'true') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('EVIDA API')
        .setDescription('Evidence Driven Hiring Platform — REST API v1. Authentication: HttpOnly session cookie + X-CSRF-Token header, or Bearer access token. Candidate portal: X-Candidate-Token header.')
        .setVersion('1.0.0')
        .addCookieAuth('evida_at')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/openapi.json' });
  }

  await app.listen(e.API_PORT, '0.0.0.0');
  logger.info({ port: e.API_PORT }, 'evida_api_started');
  process.on('SIGTERM', () => void closeQueues());
}

bootstrap().catch((err) => {
  logger.fatal({ err: err.message }, 'evida_api_failed_to_start');
  process.exit(1);
});

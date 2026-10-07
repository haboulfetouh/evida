/** Writes the OpenAPI 3 document to docs/openapi.json (used for typed client generation). */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

(async () => {
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule, { logger: false }));
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('EVIDA API').setVersion('1.0.0').addCookieAuth('evida_at').addBearerAuth().build());
  writeFileSync('../../docs/openapi.json', JSON.stringify(doc, null, 2));
  await app.close();
  process.exit(0);
})();

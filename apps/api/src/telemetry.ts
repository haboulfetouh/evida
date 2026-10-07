/**
 * OpenTelemetry bootstrap — imported first by main.ts and worker.ts so auto-instrumentation
 * (http, express, pg, ioredis) patches modules before they load. Exports traces over OTLP;
 * metrics are scraped by Prometheus from /metrics; logs are structured JSON (pino) → Loki.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (endpoint && process.env.NODE_ENV !== 'test') {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'evida-api',
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })],
  });
  sdk.start();
  process.on('SIGTERM', () => void sdk.shutdown());
}

/** Sentry error tracking (5xx and worker failures). PII is never sent: default PII collection is off. */
import * as Sentry from '@sentry/node';
if (process.env.SENTRY_DSN && process.env.NODE_ENV !== 'test') {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV, sendDefaultPii: false, tracesSampleRate: 0, skipOpenTelemetrySetup: true });
}
export { Sentry };

import { Sentry } from './telemetry';
import 'reflect-metadata';
import { Job, Worker } from 'bullmq';
import { collectDefaultMetrics, Counter, Histogram, register } from 'prom-client';
import http from 'node:http';
import { DEFAULT_JOB_OPTS, enqueue, queue, QUEUES, redis, type QueueName } from './infra/queues';
import { publishInterviewEvent } from './infra/events';
import { logger } from './common/logger';
import { WebhookEmitter } from './common/webhook.emitter';
import { workerContext } from './worker/context';
import { analyzeCv, decisionSummary, extractEvidence, fullPipeline, generateCompetencies, generatePlan, suggestScores } from './worker/ai.processors';
import { deliverWebhook, feedbackReminder, retentionCleanup, sendEmail } from './worker/ops.processors';

const ctx = workerContext();
const webhooks = new WebhookEmitter(ctx.prisma);
const enqueueSummary = (applicationId: string, organizationId?: string) =>
  enqueue(QUEUES.summary, 'decision_summary', { organizationId, applicationId }, `sum:${applicationId}:${Date.now() >> 16}`);

collectDefaultMetrics({ prefix: 'evida_worker_' });
const jobsTotal = new Counter({ name: 'evida_jobs_total', help: 'Background jobs processed', labelNames: ['queue', 'name', 'result'] });
const jobDuration = new Histogram({ name: 'evida_job_duration_seconds', help: 'Background job duration', labelNames: ['queue', 'name'], buckets: [0.1, 0.5, 1, 5, 15, 30, 60, 120, 300] });

/** Per-queue timeouts; a job exceeding it fails and is retried with backoff. */
const TIMEOUT_MS: Partial<Record<QueueName, number>> = {
  [QUEUES.ai]: 240_000, [QUEUES.evidence]: 300_000, [QUEUES.candidate]: 180_000, [QUEUES.summary]: 180_000,
  [QUEUES.email]: 30_000, [QUEUES.webhooks]: 20_000, [QUEUES.notifications]: 30_000, [QUEUES.cleanup]: 900_000,
};

type Handler = (job: Job) => Promise<unknown>;
const handlers: Partial<Record<QueueName, Handler>> = {
  [QUEUES.ai]: async (job) => {
    switch (job.name) {
      case 'competency_framework': return generateCompetencies(ctx, job.data);
      case 'interview_plan': return generatePlan(ctx, job.data);
      case 'score_suggestion': return suggestScores(ctx, job.data);
      default: throw new Error(`unknown ai job ${job.name}`);
    }
  },
  [QUEUES.evidence]: async (job) => {
    if (job.name === 'full_extraction') return fullPipeline(ctx, job.data, webhooks, (appId) => enqueueSummary(appId, job.data.organizationId));
    const res = await extractEvidence(ctx, job.data);
    await ctx.prisma.interview.updateMany({ where: { id: job.data.interviewId, aiStatus: 'PROCESSING' }, data: { aiStatus: 'NOT_STARTED' } });
    return res;
  },
  [QUEUES.candidate]: async (job) => analyzeCv(ctx, job.data),
  [QUEUES.summary]: async (job) => decisionSummary(ctx, job.data),
  [QUEUES.email]: async (job) => sendEmail(ctx, job.data),
  [QUEUES.notifications]: async (job) => feedbackReminder(ctx, job.data),
  [QUEUES.webhooks]: async (job) => deliverWebhook(ctx, job.data, job.attemptsMade + 1, job.opts.attempts ?? DEFAULT_JOB_OPTS.attempts!),
  [QUEUES.cleanup]: async () => retentionCleanup(ctx),
};

const concurrency: Partial<Record<QueueName, number>> = { [QUEUES.ai]: 4, [QUEUES.evidence]: 4, [QUEUES.candidate]: 4, [QUEUES.summary]: 2, [QUEUES.email]: 10, [QUEUES.webhooks]: 10 };

const workers = (Object.entries(handlers) as [QueueName, Handler][]).map(([name, handler]) => {
  const w = new Worker(
    name,
    async (job) => {
      const end = jobDuration.startTimer({ queue: name, name: job.name });
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          handler(job),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`job timeout after ${TIMEOUT_MS[name]}ms`)), TIMEOUT_MS[name] ?? 120_000); }),
        ]);
      } finally {
        clearTimeout(timer);
        end();
      }
    },
    { connection: redis(), concurrency: concurrency[name] ?? 5, lockDuration: (TIMEOUT_MS[name] ?? 120_000) + 30_000 },
  );
  w.on('completed', (job) => {
    jobsTotal.inc({ queue: name, name: job.name, result: 'completed' });
    logger.info({ queue: name, job: job.name, id: job.id }, 'job_completed');
  });
  w.on('failed', async (job, err) => {
    if (!job) return;
    jobsTotal.inc({ queue: name, name: job.name, result: 'failed' });
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    logger.warn({ queue: name, job: job.name, id: job.id, attempt: job.attemptsMade, final, err: err.message }, 'job_failed');
    if (!final) return;
    Sentry.captureException(err, { tags: { queue: name, job: job.name } });
    // Dead-letter: keep a reference for operators; data holds ids only (no sensitive payloads).
    await queue(QUEUES.deadLetter).add('dead', { queue: name, name: job.name, jobId: job.id, data: job.data, error: err.message.slice(0, 500) }, { removeOnComplete: false, attempts: 1 });
    const interviewId = (job.data as { interviewId?: string }).interviewId;
    const orgId = (job.data as { organizationId?: string }).organizationId;
    if (interviewId && orgId && (name === QUEUES.evidence || name === QUEUES.ai)) {
      await ctx.prisma.interview.update({ where: { id: interviewId }, data: { aiStatus: 'FAILED' } }).catch(() => undefined);
      await publishInterviewEvent(orgId, { type: 'ai.status', interviewId, status: 'FAILED' }).catch(() => undefined);
    }
  });
  return w;
});

async function main() {
  // Daily retention job at 02:30 UTC (repeatable; BullMQ de-duplicates the schedule).
  await queue(QUEUES.cleanup).upsertJobScheduler('retention-daily', { pattern: '30 2 * * *' }, { name: 'retention', data: {} });
  // Health + metrics for the worker (k8s probes, Prometheus).
  http
    .createServer(async (req, res) => {
      if (req.url === '/health/live') return res.end('ok');
      if (req.url === '/health/ready') {
        try {
          await redis().ping();
          return res.end('ready');
        } catch {
          res.statusCode = 503;
          return res.end('not ready');
        }
      }
      if (req.url === '/metrics') {
        res.setHeader('content-type', register.contentType);
        return res.end(await register.metrics());
      }
      res.statusCode = 404;
      res.end();
    })
    .listen(Number(process.env.WORKER_PORT ?? 4100));
  logger.info({ queues: Object.keys(handlers) }, 'evida_worker_started');
}

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  await ctx.prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
main().catch((e) => {
  logger.fatal({ err: e.message }, 'worker_failed_to_start');
  process.exit(1);
});

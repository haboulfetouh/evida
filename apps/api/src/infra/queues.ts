import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config';

/** Queue names (spec §74). One queue per concern so each can be scaled and monitored separately. */
export const QUEUES = {
  ai: 'ai_processing',
  evidence: 'evidence_extraction',
  candidate: 'candidate_analysis',
  summary: 'interview_summary',
  notifications: 'notifications',
  email: 'email',
  webhooks: 'webhooks',
  cleanup: 'cleanup',
  deadLetter: 'dead_letter',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Retry with exponential backoff; completed jobs are trimmed, failed ones kept for inspection. */
export const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 14 * 24 * 3600 },
};

let connection: IORedis | null = null;
export function redis(): IORedis {
  if (!connection) connection = new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });
  return connection;
}

const queues = new Map<string, Queue>();
export function queue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis(), defaultJobOptions: DEFAULT_JOB_OPTS });
    queues.set(name, q);
  }
  return q;
}

/**
 * Enqueue with an idempotency key: BullMQ ignores a second add with the same jobId while
 * the first one still exists, so double-clicks and retried HTTP requests do not duplicate work.
 */
export async function enqueue<T extends object>(name: QueueName, jobName: string, data: T, idempotencyKey?: string, opts: JobsOptions = {}) {
  const jobId = idempotencyKey ? idempotencyKey.replace(/:/g, '_') : undefined;
  return queue(name).add(jobName, data, { ...opts, jobId });
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  if (connection) await connection.quit();
}

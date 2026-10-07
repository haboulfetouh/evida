import IORedis from 'ioredis';
import { env } from '../config';

/**
 * Live interview events (evidence detected, coverage changed, copilot suggestions, AI status).
 * Workers publish to Redis; the API streams them to interviewers over Server-Sent Events.
 * Channel names are scoped by organization and interview to prevent cross-tenant leakage.
 */
export type InterviewEvent =
  | { type: 'evidence.updated'; interviewId: string }
  | { type: 'coverage.updated'; interviewId: string }
  | { type: 'copilot.suggestions'; interviewId: string; suggestions: unknown[] }
  | { type: 'ai.status'; interviewId: string; status: string }
  | { type: 'transcript.appended'; interviewId: string; count: number };

export const channelFor = (organizationId: string, interviewId: string) => `evida:${organizationId}:interview:${interviewId}`;

let pub: IORedis | null = null;
export async function publishInterviewEvent(organizationId: string, ev: InterviewEvent) {
  if (!pub) pub = new IORedis(env().REDIS_URL, { maxRetriesPerRequest: 2 });
  await pub.publish(channelFor(organizationId, ev.interviewId), JSON.stringify(ev));
}

export function subscriber(): IORedis {
  return new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null });
}

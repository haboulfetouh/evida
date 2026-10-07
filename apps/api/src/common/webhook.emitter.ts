import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from './prisma.service';
import { enqueue, QUEUES } from '../infra/queues';

export const WEBHOOK_EVENTS = [
  'candidate.created', 'candidate.updated', 'interview.created', 'interview.scheduled', 'interview.started',
  'interview.completed', 'transcript.ready', 'evidence.ready', 'scorecard.completed', 'decision.created',
  'candidate.hired', 'candidate.rejected',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * Outbound webhooks. Payloads carry identifiers and state only — never CV text, transcripts
 * or evidence quotes — so integrators fetch sensitive data through the authenticated API.
 */
@Injectable()
export class WebhookEmitter {
  constructor(private readonly prisma: PrismaService) {}

  async emit(organizationId: string, event: WebhookEvent, data: Record<string, unknown>) {
    const hooks = await this.prisma.webhook.findMany({ where: { organizationId, isActive: true, events: { has: event } }, select: { id: true } });
    const eventId = randomUUID();
    for (const h of hooks) {
      await this.prisma.webhookDelivery.create({ data: { webhookId: h.id, event, eventId } });
      await enqueue(QUEUES.webhooks, event, { webhookId: h.id, eventId, event, data, occurredAt: new Date().toISOString() }, `wh:${h.id}:${eventId}`, { attempts: 8 });
    }
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { enqueue, QUEUES } from '../infra/queues';
import type { Locale, TemplateId } from '../infra/templates';

/** Notifications are persisted, then delivered asynchronously by the worker. */
@Injectable()
export class NotifyService {
  constructor(private readonly prisma: PrismaService) {}

  async email(p: { organizationId: string; userId?: string | null; to: string; template: TemplateId; locale: Locale; vars: Record<string, string | number | undefined>; delayMs?: number }) {
    const n = await this.prisma.notification.create({
      data: { organizationId: p.organizationId, userId: p.userId ?? null, channel: 'EMAIL', template: p.template, recipient: p.to },
    });
    await enqueue(QUEUES.email, p.template, { notificationId: n.id, to: p.to, template: p.template, locale: p.locale, vars: p.vars }, `email:${n.id}`, { delay: p.delayMs });
    return n;
  }

  async inApp(p: { organizationId: string; userId: string; title: string; link?: string; template: string }) {
    return this.prisma.notification.create({
      data: { organizationId: p.organizationId, userId: p.userId, channel: 'IN_APP', template: p.template, recipient: p.userId, title: p.title, link: p.link, status: 'SENT', sentAt: new Date() },
    });
  }
}

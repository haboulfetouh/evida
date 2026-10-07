import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { lookup } from 'node:dns/promises';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, Public, Requires } from '../../common/decorators';
import { ZodPipe } from '../../common/zod.pipe';
import { randomToken, verifyWebhook } from '../../common/crypto';
import { WEBHOOK_EVENTS } from '../../common/webhook.emitter';
import type { Principal } from '../../common/context';
import { env } from '../../config';
import { InterviewsService } from '../interviews/interviews.service';
import { deleteObject } from '../../infra/storage';

const WebhookDto = z.object({ url: z.string().url().max(500), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) });

/** SSRF protection for outbound webhooks: https only, no private/link-local/loopback targets. */
export async function assertPublicHttpsUrl(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' && env().NODE_ENV === 'production') throw new BadRequestException({ code: 'URL_INSECURE', message: 'Webhook URLs must use HTTPS' });
  const addrs = await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new BadRequestException({ code: 'URL_UNRESOLVABLE' });
  const priv = /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|fc|fd|fe80)/i;
  if (env().NODE_ENV === 'production' && addrs.some((a) => priv.test(a.address))) throw new BadRequestException({ code: 'URL_PRIVATE', message: 'Webhook URL resolves to a private address' });
}

const JitsiEventDto = z.discriminatedUnion('event', [
  z.object({ event: z.literal('transcription.segment'), roomName: z.string(), segments: z.array(z.object({ speaker: z.string(), startSec: z.number(), endSec: z.number().optional(), text: z.string() })).min(1).max(200) }),
  z.object({ event: z.literal('participant.joined'), roomName: z.string(), participant: z.string().max(200) }),
  z.object({ event: z.literal('conference.ended'), roomName: z.string() }),
  // Jibri finalize script uploads the file to <bucket>/<orgId>/recordings/<uuid>.mp4, then reports it.
  z.object({ event: z.literal('recording.uploaded'), roomName: z.string(), storageKey: z.string().regex(/^[0-9a-f-]{36}\/recordings\/[0-9a-f-]{36}\.(mp4|webm)$/), sizeBytes: z.number().int().min(1), durationSec: z.number().int().min(0).optional() }),
]);

@ApiTags('integrations')
@Controller()
export class IntegrationsController {
  private readonly log = new Logger('Integrations');
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly interviews: InterviewsService) {}

  @Get('webhooks')
  @Requires('integration.manage')
  async list(@CurrentUser() u: Principal) {
    const hooks = await this.prisma.webhook.findMany({ where: { organizationId: u.organizationId }, orderBy: { createdAt: 'desc' } });
    const deliveries = await this.prisma.webhookDelivery.findMany({ where: { webhookId: { in: hooks.map((h) => h.id) } }, orderBy: { createdAt: 'desc' }, take: 50 });
    return hooks.map(({ secret, ...h }) => ({ ...h, secretHint: `…${secret.slice(-4)}`, recentDeliveries: deliveries.filter((d) => d.webhookId === h.id).slice(0, 10) }));
  }

  /** The signing secret is shown once, at creation. */
  @Post('webhooks')
  @Requires('integration.manage')
  async create(@CurrentUser() u: Principal, @Body(new ZodPipe(WebhookDto)) dto: z.infer<typeof WebhookDto>) {
    await assertPublicHttpsUrl(dto.url);
    const secret = `whsec_${randomToken(32)}`;
    const h = await this.prisma.webhook.create({ data: { organizationId: u.organizationId, url: dto.url, events: dto.events, secret } });
    await this.audit.log({ action: 'integration.webhook_create', resourceType: 'webhook', resourceId: h.id, metadata: { events: dto.events } });
    return { id: h.id, url: h.url, events: h.events, secret };
  }

  @Delete('webhooks/:id')
  @Requires('integration.manage')
  async remove(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.prisma.webhook.updateMany({ where: { id, organizationId: u.organizationId }, data: { isActive: false } });
    if (!res.count) throw new NotFoundException({ code: 'NOT_FOUND' });
    await this.audit.log({ action: 'integration.webhook_disable', resourceType: 'webhook', resourceId: id });
    return { ok: true };
  }

  /**
   * Inbound events from the Jitsi deployment (transcriber relay / prosody event-sync module),
   * authenticated with HMAC-SHA256 over "<timestamp>.<raw body>" and a 5-minute replay window.
   */
  @Public()
  @HttpCode(202)
  @Post('integrations/jitsi/events')
  async jitsi(@Req() req: Request & { rawBody?: Buffer }, @Body() body: unknown) {
    const secret = env().JITSI_WEBHOOK_SECRET;
    if (!secret) throw new NotFoundException();
    const ts = Number(req.header('x-evida-timestamp'));
    const sig = req.header('x-evida-signature') ?? '';
    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(body);
    if (!verifyWebhook(secret, raw, ts, sig)) throw new UnauthorizedException({ code: 'SIGNATURE_INVALID' });
    const ev = JitsiEventDto.parse(body);
    const iv = await this.prisma.interview.findUnique({ where: { roomName: ev.roomName } });
    if (!iv) return { ignored: true };
    if (ev.event === 'transcription.segment') {
      try {
        await this.interviews.ingest(iv.id, ev.segments, { source: 'jitsi-transcriber' });
      } catch (e) {
        this.log.warn(`transcriber segments rejected: ${(e as Error).message}`);
        return { accepted: false };
      }
    } else if (ev.event === 'recording.uploaded') {
      const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: iv.organizationId } });
      const consent = await this.interviews.consent(iv.id);
      // Only accept recordings for this tenant's prefix, with recording enabled and consent granted; otherwise delete.
      if (!ev.storageKey.startsWith(`${iv.organizationId}/`) || !org.recordingEnabled || !iv.recordingEnabled || consent.RECORDING !== 'GRANTED') {
        await deleteObject(ev.storageKey).catch(() => undefined);
        await this.audit.log({ action: 'recording.discarded', resourceType: 'interview', resourceId: iv.id, organizationId: iv.organizationId, actorType: 'SYSTEM' });
        return { accepted: false };
      }
      const days = (org.retention as { recordingsDays: number }).recordingsDays;
      const file = await this.prisma.file.create({ data: { organizationId: iv.organizationId, storageKey: ev.storageKey, originalName: `interview-${iv.id}.${ev.storageKey.split('.').pop()}`, mimeType: ev.storageKey.endsWith('.webm') ? 'video/webm' : 'video/mp4', sizeBytes: ev.sizeBytes, sha256: 'n/a', scanStatus: 'SKIPPED' } });
      await this.prisma.recording.create({ data: { organizationId: iv.organizationId, interviewId: iv.id, fileId: file.id, durationSec: ev.durationSec ?? null, expiresAt: new Date(Date.now() + days * 86_400_000) } });
    } else if (ev.event === 'participant.joined' && iv.status === 'SCHEDULED') {
      await this.prisma.interview.update({ where: { id: iv.id }, data: { status: 'IN_PROGRESS', startedAt: new Date() } });
    }
    await this.audit.log({ action: `jitsi.${ev.event}`, resourceType: 'interview', resourceId: iv.id, organizationId: iv.organizationId, actorType: 'SYSTEM' });
    return { accepted: true };
  }
}

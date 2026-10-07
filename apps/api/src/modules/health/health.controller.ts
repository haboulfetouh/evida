import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { collectDefaultMetrics, register } from 'prom-client';
import { PrismaService } from '../../common/prisma.service';
import { Public } from '../../common/decorators';
import { redis } from '../../infra/queues';

collectDefaultMetrics({ prefix: 'evida_api_' });

@ApiExcludeController()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('health/ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await redis().ping();
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready' });
    }
  }

  /** Prometheus scrape endpoint. Expose only on the internal network (see k8s NetworkPolicy). */
  @Public()
  @Get('metrics')
  @Header('Content-Type', register.contentType)
  metrics() {
    return register.metrics();
  }
}

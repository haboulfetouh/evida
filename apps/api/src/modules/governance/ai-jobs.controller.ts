import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import type { Principal } from '../../common/context';
import { queue, QUEUES, type QueueName } from '../../infra/queues';

/** Poll the status of a queued AI task. Jobs from other tenants are reported as not found. */
@ApiTags('ai')
@Controller('ai/jobs')
export class AiJobsController {
  @Get(':queue/:id')
  async status(@CurrentUser() u: Principal, @Param('queue') q: string, @Param('id') id: string) {
    if (!Object.values(QUEUES).includes(q as QueueName)) throw new NotFoundException();
    const job = await queue(q as QueueName).getJob(id);
    if (!job || (job.data as { organizationId?: string }).organizationId !== u.organizationId) throw new NotFoundException();
    const state = await job.getState();
    return { id: job.id, name: job.name, state, attemptsMade: job.attemptsMade, failedReason: state === 'failed' ? 'AI processing failed. Try again later.' : null, result: state === 'completed' ? job.returnvalue : null };
  }
}

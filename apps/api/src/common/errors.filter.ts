import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '../db';
import { currentContext } from './context';
import { logger } from './logger';
import { Sentry } from '../telemetry';

/** Uniform error envelope; internal details never reach the client. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const requestId = currentContext()?.requestId;
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { code: 'INTERNAL_ERROR', message: 'Unexpected error' };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse();
      body = typeof r === 'string' ? { code: HttpStatus[status], message: r } : (r as Record<string, unknown>);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = 409;
        body = { code: 'CONFLICT', message: 'Resource already exists' };
      } else if (exception.code === 'P2025') {
        status = 404;
        body = { code: 'NOT_FOUND', message: 'Resource not found' };
      }
    }
    if (status >= 500) {
      logger.error({ requestId, err: (exception as Error)?.message, stack: (exception as Error)?.stack }, 'unhandled');
      Sentry.captureException(exception, { tags: { requestId } });
    }
    res.status(status).json({ ...body, requestId });
  }
}

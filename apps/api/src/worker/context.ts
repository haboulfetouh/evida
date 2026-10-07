import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { AiService } from '../ai/ai.service';
import { EvidenceProfileService } from '../domain/evidence-profile.service';
import { NotifyService } from '../common/notify.service';

/** Worker-side service graph (the worker runs without the HTTP layer). */
export function workerContext() {
  const prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const ai = new AiService(prisma, audit);
  const profiles = new EvidenceProfileService(prisma);
  const notify = new NotifyService(prisma);
  return { prisma, audit, ai, profiles, notify };
}
export type WorkerContext = ReturnType<typeof workerContext>;

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../db';
import { env } from '../config';

export function createPrismaClient(url = env().DATABASE_URL) {
  // node-postgres pool; size tuned per deployment via DB_POOL_MAX.
  const adapter = new PrismaPg({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
  return new PrismaClient({ adapter });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: env().DATABASE_URL, max: Number(process.env.DB_POOL_MAX ?? 10) }) });
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

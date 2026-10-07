#!/usr/bin/env node
/**
 * Applies pending migrations from prisma/migrations using node-postgres, recording them in
 * Prisma's own `_prisma_migrations` table (same checksum format), so `prisma migrate deploy`
 * and this script can be used interchangeably. Used in CI/test and offline environments.
 *
 *   DATABASE_URL=postgresql://... node scripts/migrate-deploy.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const dir = 'prisma/migrations';
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL, "checksum" VARCHAR(64) NOT NULL, "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL, "logs" TEXT, "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(), "applied_steps_count" INTEGER NOT NULL DEFAULT 0)`);
// Serialise concurrent deploys (e.g. several pods starting at once).
await client.query('SELECT pg_advisory_lock(72707369)');
try {
  const applied = new Set((await client.query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows.map((r) => r.migration_name));
  const pending = fs.readdirSync(dir).filter((d) => /^\d{14}_/.test(d) && !applied.has(d)).sort();
  for (const name of pending) {
    const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const id = crypto.randomUUID();
    await client.query('BEGIN');
    try {
      await client.query('INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES ($1,$2,$3,now())', [id, checksum, name]);
      await client.query(sql);
      await client.query('UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1', [id]);
      await client.query('COMMIT');
      console.log(`applied ${name}`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`failed ${name}: ${e.message}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!pending.length) console.log('No pending migrations.');
} finally {
  await client.query('SELECT pg_advisory_unlock(72707369)');
  await client.end();
}

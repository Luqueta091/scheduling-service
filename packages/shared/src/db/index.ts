import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Pool, type PoolClient } from 'pg';

import { config } from '../config';
import { logger } from '../logger';

let pool: Pool | null = null;

export type DbClient = PoolClient;

export function getDb(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_MAX_POOL
    });
  }

  return pool;
}

export async function withTransaction<T>(
  handler: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getDb().connect();

  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function runMigrations(): Promise<void> {
  const migrationsDir = config.MIGRATIONS_DIR;
  const files = await fs.readdir(migrationsDir);
  const sqlFiles = files.filter((file) => file.endsWith('.sql')).sort();

  if (sqlFiles.length === 0) {
    logger.info({ migrationsDir }, 'No SQL migrations found');
    return;
  }

  const client = await getDb().connect();

  try {
    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, 'utf-8');

      logger.info({ migration: file }, 'Applying migration');
      await client.query(sql);
    }

    logger.info({ executed: sqlFiles.length }, 'All migrations applied');
  } catch (error) {
    logger.error({ error }, 'Failed to apply migrations');
    throw error;
  } finally {
    client.release();
  }
}

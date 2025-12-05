import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

import { Client } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

type SharedModule = typeof import('../../packages/shared/src/index');

interface BaseTestDatabaseContext {
  truncateAll(): Promise<void>;
  clearEventBus(): Promise<void>;
  stop(): Promise<void>;
  connectionString: string;
}

const LOCAL_DB_DEFAULT_URL = 'postgresql://postgres:postgres@localhost:5432/scheduling_test';

async function ensureDatabaseExists(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  const databaseName = url.pathname.replace('/', '') || 'postgres';

  const adminUrl = new URL(connectionString);
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (result.rowCount === 0) {
      await client.query(`CREATE DATABASE "${databaseName}"`);
    }
  } finally {
    await client.end();
  }
}

async function createSharedDependencies(connectionString: string) {
  process.env.DATABASE_URL = connectionString;
  process.env.PORT = process.env.PORT ?? '3000';
  process.env.RESERVATION_TTL = process.env.RESERVATION_TTL ?? '120';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';

  const shared = (await import('@barbershop/shared')) as unknown as SharedModule;
  await shared.runMigrations();

  const truncateAll = async () => {
    const { getDb } = (await import('@barbershop/shared')) as unknown as SharedModule;
    const client = await getDb().connect();
    try {
      await client.query('TRUNCATE TABLE appointments RESTART IDENTITY CASCADE');
      await client.query('TRUNCATE TABLE reservations RESTART IDENTITY CASCADE');
      await client.query('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
      await client.query('TRUNCATE TABLE idempotency_keys RESTART IDENTITY CASCADE');
    } finally {
      client.release();
    }
  };

  const clearEventBus = async () => {
    const { eventBus } = (await import('@barbershop/shared')) as unknown as SharedModule;
    eventBus.clearAllSubscribers();
  };

  return { shared, truncateAll, clearEventBus } as const;
}

export async function setupTestDatabase(): Promise<BaseTestDatabaseContext> {
  const useLocalDatabase = process.env.TEST_USE_LOCAL_DB === 'true';

  if (useLocalDatabase) {
    const connectionString = process.env.TEST_DATABASE_URL ?? LOCAL_DB_DEFAULT_URL;
    await ensureDatabaseExists(connectionString);
    const { truncateAll, clearEventBus } = await createSharedDependencies(connectionString);

    return {
      connectionString,
      truncateAll,
      clearEventBus,
      async stop() {
        const { closeDb } = (await import('@barbershop/shared')) as unknown as SharedModule;
        await closeDb();
      }
    };
  }

  const container = await new PostgreSqlContainer()
    .withDatabase('scheduling_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const connectionString = container.getConnectionUri();
  const { truncateAll, clearEventBus } = await createSharedDependencies(connectionString);

  return {
    connectionString,
    truncateAll,
    clearEventBus,
    async stop() {
      const { closeDb } = (await import('@barbershop/shared')) as unknown as SharedModule;
      await closeDb();
      await container.stop();
    }
  };
}

export async function seedLockedReservation({
  reservationToken,
  start,
  end,
  unitId,
  serviceId,
  barberId
}: {
  reservationToken?: string;
  start: Date;
  end: Date;
  unitId: string;
  serviceId: string;
  barberId?: string | null;
}): Promise<{ reservationId: string; reservationToken: string }> {
  const token = reservationToken ?? `resv_${randomUUID()}`;
  const reservationId = randomUUID();

  const { getDb } = (await import('@barbershop/shared')) as unknown as SharedModule;
  await getDb().query(
    `INSERT INTO reservations (
      id,
      reservation_token,
      unit_id,
      service_id,
      barber_id,
      start_ts,
      end_ts,
      status,
      expires_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,'locked', now() + interval '10 minutes')`,
    [
      reservationId,
      token,
      unitId,
      serviceId,
      barberId ?? null,
      start.toISOString(),
      end.toISOString()
    ]
  );

  return { reservationId, reservationToken: token };
}

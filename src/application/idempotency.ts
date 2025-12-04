import type { PoolClient } from 'pg';

import { config } from '@barbershop/shared';

interface IdempotencyRecord {
  key: string;
  response_body: unknown;
  created_at: string;
  expires_at: string | null;
}

export async function getIdempotentResponse(
  client: PoolClient,
  key: string
): Promise<unknown | null> {
  const result = await client.query<IdempotencyRecord>(
    'SELECT response_body FROM idempotency_keys WHERE key = $1 AND (expires_at IS NULL OR expires_at > now())',
    [key]
  );

  return result.rows[0]?.response_body ?? null;
}

export async function saveIdempotentResponse(
  client: PoolClient,
  key: string,
  response: unknown
): Promise<void> {
  const ttlSeconds = config.IDEMPOTENCY_TTL_SECONDS;
  await client.query(
    `INSERT INTO idempotency_keys (key, response_body, expires_at)
     VALUES ($1, $2, now() + ($3 || ' seconds')::interval)
     ON CONFLICT (key) DO UPDATE SET response_body = EXCLUDED.response_body, expires_at = EXCLUDED.expires_at`,
    [key, response, ttlSeconds]
  );
}

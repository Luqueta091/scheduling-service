import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

beforeAll(() => {
  process.env = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost/test',
    PORT: process.env.PORT ?? '3000',
    RESERVATION_TTL: process.env.RESERVATION_TTL ?? '120',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info'
  };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('shared logger', () => {
  it('attaches context via withContext', async () => {
    vi.resetModules();
    const { logger } = await import('@barbershop/shared');

    const child = logger.withContext({ reservationToken: 'tok_123', userId: 'user_456' });

    const bindings = (child as any).bindings();

    expect(bindings.reservationToken).toBe('tok_123');
    expect(bindings.userId).toBe('user_456');
  });
});

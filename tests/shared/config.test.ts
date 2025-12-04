import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('shared config', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws ConfigError when DATABASE_URL is missing', async () => {
    const { ConfigError, loadConfig } = await import('@barbershop/shared');

    expect(() =>
      loadConfig({
        DATABASE_URL: '',
        PORT: '3000',
        RESERVATION_TTL: '120',
        LOG_LEVEL: 'info'
      })
    ).toThrow(ConfigError);
  });

  it('parses METRICS_ENABLED as boolean', async () => {
    const { loadConfig } = await import('@barbershop/shared');

    const cfg = loadConfig({
      DATABASE_URL: 'postgresql://example',
      PORT: '3000',
      RESERVATION_TTL: '120',
      METRICS_ENABLED: 'false',
      LOG_LEVEL: 'info'
    });

    expect(cfg.METRICS_ENABLED).toBe(false);
  });
});

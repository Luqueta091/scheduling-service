import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HttpSlotClient, type SlotLockValidation } from '../../src/integrations/slotClient';

describe('HttpSlotClient', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let handler: (url: string, respond: (status: number, body?: unknown) => void) => void;

  beforeAll(async () => {
    handler = (_url, respond) => {
      respond(200, createPayload('default'));
    };

    server = createServer((req, res) => {
      const respond = (status: number, body?: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body ? JSON.stringify(body) : undefined);
      };

      if (!req.url) {
        respond(400);
        return;
      }

      handler(req.url, respond);
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (address && typeof address === 'object') {
      baseUrl = `http://127.0.0.1:${address.port}`;
    } else {
      throw new Error('Failed to start mock slot server');
    }
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fetches slots successfully and caches the response', async () => {
    handler = (url, respond) => {
      if (url.includes('token-success')) {
        respond(200, createPayload('token-success'));
        return;
      }
      respond(404);
    };

    const client = new HttpSlotClient(baseUrl, {
      cacheTtlMs: 5000
    });

    const first = await client.validateReservationToken('token-success');
    expect(first.reservationToken).toBe('token-success');

    handler = (_url, respond) => {
      respond(500);
    };

    const cached = await client.validateReservationToken('token-success');
    expect(cached.reservationToken).toBe('token-success');
    expect(client.getHealth().status).toBe('ok');
  });

  it('falls back to cached value when circuit is open', async () => {
    handler = (url, respond) => {
      respond(200, createPayload(url));
    };

    const client = new HttpSlotClient(baseUrl, {
      timeoutMs: 50,
      cacheTtlMs: 2000,
      failureThreshold: 1,
      maxRetries: 1,
      resetTimeoutMs: 200
    });

    await client.validateReservationToken('token-cache');

    handler = () => {
      // never respond to trigger timeout
    };

    const cached = await client.validateReservationToken('token-cache');
    expect(cached.reservationToken).toBe('token-cache');
    expect(client.getHealth().status).not.toBe('ok');
  });

  it('throws NotFoundError for missing reservations', async () => {
    handler = (_url, respond) => {
      respond(404);
    };

    const client = new HttpSlotClient(baseUrl, {
      timeoutMs: 50,
      maxRetries: 1
    });

    await expect(() => client.validateReservationToken('missing-token')).rejects.toThrowError(
      'Reservation token not found'
    );
  });
});

function createPayload(token: string): SlotLockValidation {
  return {
    reservationToken: token,
    unitId: 'unit',
    serviceId: 'service',
    barberId: null,
    start: new Date('2025-12-01T10:00:00Z').toISOString(),
    end: new Date('2025-12-01T10:30:00Z').toISOString()
  };
}

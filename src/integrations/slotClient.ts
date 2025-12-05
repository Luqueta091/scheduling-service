import {
  ConflictError,
  NotFoundError,
  config,
  logger,
  updateSlotServiceHealth
} from '@barbershop/shared';

export interface SlotLockValidation {
  reservationToken: string;
  unitId: string;
  serviceId: string;
  barberId?: string | null;
  start: string;
  end: string;
}

export interface SlotClientHealth {
  status: 'ok' | 'degraded' | 'down';
  breakerState: CircuitState;
  lastFailureAt?: string;
  failureReason?: string;
}

export interface SlotClient {
  validateReservationToken(token: string): Promise<SlotLockValidation>;
  getHealth(): SlotClientHealth;
}

type CircuitState = 'closed' | 'half-open' | 'open';

interface SlotClientOptions {
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
  failureThreshold: number;
  resetTimeoutMs: number;
  cacheTtlMs: number;
}

export class HttpSlotClient implements SlotClient {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { value: SlotLockValidation; expiresAt: number }>();
  private circuitState: CircuitState = 'closed';
  private failureCount = 0;
  private nextAttemptAt = 0;
  private lastFailure?: { at: number; reason: string };

  constructor(private readonly baseUrl: string, options: Partial<SlotClientOptions> = {}) {
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.maxRetries = options.maxRetries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 150;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 5000;
    this.cacheTtlMs = options.cacheTtlMs ?? config.RESERVATION_TTL * 1000;
    this.updateHealthMetric();
  }

  async validateReservationToken(token: string): Promise<SlotLockValidation> {
    const cached = this.getCached(token);

    if (this.circuitState === 'open' && Date.now() >= this.nextAttemptAt) {
      this.circuitState = 'half-open';
    }

    if (this.circuitState === 'open' && cached) {
      logger.warn({ token }, 'Slot client breaker open, returning cached reservation');
      return cached;
    }

    try {
      if (this.circuitState === 'open' && !cached) {
        throw new ConflictError('Slot service unavailable');
      }

      const result = await this.fetchWithRetry(token);
      this.recordSuccess();
      this.setCached(token, result);
      return result;
    } catch (error) {
      this.recordFailure(error);
      if (cached && !(error instanceof NotFoundError)) {
        logger.warn({ token, error }, 'Slot client failure, serving cached entry');
        return cached;
      }

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new ConflictError('Failed to validate reservation token');
    }
  }

  getHealth(): SlotClientHealth {
    const status: SlotClientHealth['status'] =
      this.circuitState === 'closed'
        ? 'ok'
        : this.circuitState === 'half-open'
          ? 'degraded'
          : 'down';

    const snapshot: SlotClientHealth = {
      status,
      breakerState: this.circuitState,
      lastFailureAt: this.lastFailure ? new Date(this.lastFailure.at).toISOString() : undefined,
      failureReason: this.lastFailure?.reason
    };

    return snapshot;
  }

  private async fetchWithRetry(token: string): Promise<SlotLockValidation> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < this.maxRetries) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        const response = await fetch(`${this.baseUrl}/reservations/${token}`, {
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (response.status === 404) {
          throw new NotFoundError('Reservation token not found');
        }

        if (!response.ok) {
          throw new Error(`Slot service responded with ${response.status}`);
        }

        const payload = (await response.json()) as SlotLockValidation;
        return {
          ...payload,
          reservationToken: token
        };
      } catch (error) {
        lastError = error;
        if (error instanceof NotFoundError) {
          throw error;
        }

        attempt += 1;
        if (attempt >= this.maxRetries) {
          throw error;
        }

        await this.delay(this.baseDelayMs * attempt ** 2);
      }
    }

    throw lastError ?? new Error('Unknown slot client failure');
  }

  private getCached(token: string): SlotLockValidation | null {
    const cached = this.cache.get(token);
    if (!cached) return null;

    if (cached.expiresAt < Date.now()) {
      this.cache.delete(token);
      return null;
    }

    return cached.value;
  }

  private setCached(token: string, value: SlotLockValidation): void {
    this.cache.set(token, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs
    });
  }

  private recordFailure(error: unknown): void {
    this.failureCount += 1;
    this.lastFailure = {
      at: Date.now(),
      reason: error instanceof Error ? error.message : 'unknown'
    };

    if (this.circuitState === 'half-open' || this.failureCount >= this.failureThreshold) {
      this.circuitState = 'open';
      this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
    }

    this.updateHealthMetric();
  }

  private recordSuccess(): void {
    this.failureCount = 0;
    this.circuitState = 'closed';
    this.nextAttemptAt = 0;
    this.lastFailure = undefined;
    this.updateHealthMetric();
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private updateHealthMetric(): void {
    const current = this.getHealth().status;
    updateSlotServiceHealth(current);
  }
}

export class StubSlotClient implements SlotClient {
  constructor() {
    updateSlotServiceHealth('ok');
  }

  getHealth(): SlotClientHealth {
    return {
      status: 'ok',
      breakerState: 'closed'
    };
  }

  async validateReservationToken(token: string): Promise<SlotLockValidation> {
    logger.warn({ token }, 'Using stub slot client — always returning valid token');
    updateSlotServiceHealth('ok');
    const now = new Date().toISOString();
    return {
      reservationToken: token,
      unitId: 'stub-unit',
      serviceId: 'stub-service',
      barberId: null,
      start: now,
      end: now
    };
  }
}

export function buildSlotClient(): SlotClient {
  if (config.AVAILABILITY_BASE_URL) {
    return new HttpSlotClient(config.AVAILABILITY_BASE_URL);
  }

  return new StubSlotClient();
}

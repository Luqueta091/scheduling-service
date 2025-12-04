import { ConflictError, NotFoundError, config, logger } from '@barbershop/shared';

export interface SlotLockValidation {
  reservationToken: string;
  unitId: string;
  serviceId: string;
  barberId?: string | null;
  start: string;
  end: string;
}

export interface SlotClient {
  validateReservationToken(token: string): Promise<SlotLockValidation>;
}

export class HttpSlotClient implements SlotClient {
  constructor(private readonly baseUrl: string) {}

  async validateReservationToken(token: string): Promise<SlotLockValidation> {
    const response = await fetch(`${this.baseUrl}/reservations/${token}`);

    if (response.status === 404) {
      throw new NotFoundError('Reservation token not found');
    }

    if (!response.ok) {
      throw new ConflictError('Failed to validate reservation token');
    }

    return response.json() as Promise<SlotLockValidation>;
  }
}

export class StubSlotClient implements SlotClient {
  async validateReservationToken(token: string): Promise<SlotLockValidation> {
    logger.warn({ token }, 'Using stub slot client — always returning valid token');
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

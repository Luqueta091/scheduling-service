import type { AuthenticatedUser } from '../application/services/authService';
import type { SharedLogger } from '@barbershop/shared';

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Locals {
      authUser?: AuthenticatedUser;
       logger?: SharedLogger;
       logContext?: {
        traceId?: string;
        reservationToken?: string;
        userId?: string;
        actorRole?: string;
      };
    }
  }
}

export {};

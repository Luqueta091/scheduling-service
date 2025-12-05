import type { RequestHandler, Response } from 'express';

import type { AuthService, AuthenticatedUser } from '../../application/services/authService';
import type { StaffRole } from '../../repository/UserRepository';
import { logger } from '@barbershop/shared';

export interface AuthMiddleware {
  requireRole(role: StaffRole | StaffRole[]): RequestHandler[];
  authenticate: RequestHandler;
}

export function createAuthMiddleware(authService: AuthService): AuthMiddleware {
  const authenticate: RequestHandler = (req, res, next) => {
    const authHeader = req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'UnauthorizedError', message: 'Missing bearer token' });
      return;
    }

    const token = authHeader.replace('Bearer ', '').trim();

    try {
      const user = authService.verifyAccessToken(token);
      res.locals.authUser = user;
      updateLoggerContext(res, { userId: user.id, actorRole: user.role });
      next();
    } catch (error) {
      res.status(401).json({ error: 'UnauthorizedError', message: 'Invalid token' });
    }
  };

  const requireRole = (role: StaffRole | StaffRole[]): RequestHandler[] => {
    const allowedRoles = Array.isArray(role) ? role : [role];
    return [
      authenticate,
      (req, res, next) => {
        const user = res.locals.authUser as AuthenticatedUser | undefined;
        if (!user || !allowedRoles.includes(user.role)) {
          res.status(403).json({ error: 'ForbiddenError', message: 'Insufficient role' });
          return;
        }
        next();
      }
    ];
  };

  return { authenticate, requireRole };
}

function updateLoggerContext(res: Response, extra: Record<string, unknown>): void {
  const merged = {
    ...(res.locals.logContext ?? {}),
    ...extra
  };
  res.locals.logContext = merged;
  res.locals.logger = logger.withContext(merged);
}

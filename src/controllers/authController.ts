import { Router } from 'express';

import { runWithSpan } from '@barbershop/shared';

import type { AuthService } from '../application/services/authService';
import { loginBodySchema, refreshBodySchema } from '../dtos/auth.dto';

export function createAuthController(authService: AuthService): Router {
  const router = Router();

  router.post('/login', async (req, res, next) => {
    try {
      await runWithSpan('Controller:POST /auth/login', async () => {
        const body = loginBodySchema.parse(req.body);
        const tokens = await authService.login(body.email, body.password);
        res.status(200).json(tokens);
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/refresh', async (req, res, next) => {
    try {
      await runWithSpan('Controller:POST /auth/refresh', async () => {
        const body = refreshBodySchema.parse(req.body);
        const tokens = await authService.refresh(body.refreshToken);
        res.status(200).json(tokens);
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

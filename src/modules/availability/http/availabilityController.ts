import { Router } from 'express';
import { z } from 'zod';

import { runWithSpan } from '@barbershop/shared';

import { AvailabilityService } from '../application/availabilityService';

const querySchema = z.object({
  serviceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const lockSchema = z.object({
  unitId: z.string().uuid(),
  serviceId: z.string().uuid(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  barberId: z.string().uuid().optional().nullable()
});

const releaseSchema = z.object({
  reservationToken: z.string().min(10)
});

export function createAvailabilityRouter(service = new AvailabilityService()): Router {
  const router = Router();

  router.get('/units/:unitId/availability', async (req, res, next) => {
    try {
      const params = querySchema.parse(req.query);
      const unitId = z.string().uuid().parse(req.params.unitId);
      const payload = await runWithSpan('HTTPGET /units/:unitId/availability', () =>
        service.listAvailability({
          unitId,
          serviceId: params.serviceId,
          date: params.date
        })
      );
      res.status(200).json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.post('/slots/lock', async (req, res, next) => {
    try {
      const body = lockSchema.parse(req.body);
      const result = await runWithSpan('HTTPPOST /slots/lock', () => service.lockSlot(body));
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post('/slots/release', async (req, res, next) => {
    try {
      const body = releaseSchema.parse(req.body);
      await runWithSpan('HTTPPOST /slots/release', () =>
        service.releaseSlot(body.reservationToken)
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

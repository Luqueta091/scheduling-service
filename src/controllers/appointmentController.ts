import type { Request } from 'express';
import { Router } from 'express';

import { logger } from '@barbershop/shared';

import type {
  CancelAppointmentBody,
  CreateAppointmentRequest,
  ListAppointmentsQuery,
  MarkNoShowBody
} from '../dtos';
import {
  cancelAppointmentBodySchema,
  cancelAppointmentParamsSchema,
  createAppointmentRequestSchema,
  getAppointmentParamsSchema,
  listAppointmentsQuerySchema,
  markNoShowBodySchema,
  markNoShowParamsSchema
} from '../dtos';
import type { AppointmentService } from '../application/services/appointmentService';

export interface AppointmentControllerDependencies {
  service: AppointmentService;
}

function getReservationToken(req: Request): string | undefined {
  return req.header('x-reservation-token') ?? undefined;
}

export function createAppointmentController({ service }: AppointmentControllerDependencies): Router {
  const router = Router();

  router.post('/agendamentos', async (req, res, next) => {
    try {
      const reservationToken = getReservationToken(req);
      const payload = createAppointmentRequestSchema.parse(req.body) satisfies CreateAppointmentRequest;

      logger
        .withContext({ reservationToken })
        .info({ route: '/agendamentos', payload }, 'Creating appointment');

      const appointment = await service.createAppointment(payload, req.headers as Record<string, string | undefined>);
      res.status(201).json(appointment);
    } catch (error) {
      next(error);
    }
  });

  router.get('/agendamentos/:id', async (req, res, next) => {
    try {
      const reservationToken = getReservationToken(req);
      const params = getAppointmentParamsSchema.parse(req.params);

      logger
        .withContext({ reservationToken })
        .info({ route: '/agendamentos/:id', params }, 'Fetching appointment by id');

      const appointment = await service.getAppointmentById(params.id);
      if (!appointment) {
        return res.status(404).json({ error: 'NotFoundError', message: 'Appointment not found' });
      }

      res.status(200).json(appointment);
    } catch (error) {
      next(error);
    }
  });

  router.get('/agendamentos', async (req, res, next) => {
    try {
      const reservationToken = getReservationToken(req);
      const query = listAppointmentsQuerySchema.parse(req.query) satisfies ListAppointmentsQuery;

      logger
        .withContext({ reservationToken })
        .info({ route: '/agendamentos', query }, 'Listing appointments');

      const appointments = await service.listAppointments(query);
      res.status(200).json(appointments);
    } catch (error) {
      next(error);
    }
  });

  router.put('/agendamentos/:id/cancel', async (req, res, next) => {
    try {
      const reservationToken = getReservationToken(req);
      const params = cancelAppointmentParamsSchema.parse(req.params);
      const body = cancelAppointmentBodySchema.parse(req.body) satisfies CancelAppointmentBody;

      logger
        .withContext({ reservationToken })
        .info({ route: '/agendamentos/:id/cancel', params, body }, 'Cancelling appointment');

      const appointment = await service.cancelAppointment(params.id, body);
      res.status(200).json(appointment);
    } catch (error) {
      next(error);
    }
  });

  router.put('/agendamentos/:id/falta', async (req, res, next) => {
    try {
      const reservationToken = getReservationToken(req);
      const params = markNoShowParamsSchema.parse(req.params);
      const body = markNoShowBodySchema.parse(req.body) satisfies MarkNoShowBody;

      logger
        .withContext({ reservationToken })
        .info({ route: '/agendamentos/:id/falta', params, body }, 'Marking appointment as no-show');

      const appointment = await service.markNoShow(params.id, body);
      res.status(200).json(appointment);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

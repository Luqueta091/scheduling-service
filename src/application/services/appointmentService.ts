import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  eventBus,
  withTransaction
} from '@barbershop/shared';

import { Appointment } from '../../domain/appointment';
import type {
  AppointmentResource,
  CancelAppointmentBody,
  CreateAppointmentRequest,
  CreateAppointmentResponse,
  ListAppointmentsQuery,
  ListAppointmentsResponse,
  MarkNoShowBody
} from '../../dtos';
import type { AppointmentRepository } from '../../repository/IAppointmentRepository';
import { buildSlotClient } from '../../integrations/slotClient';
import { getIdempotentResponse, saveIdempotentResponse } from '../idempotency';

export interface AppointmentService {
  createAppointment(data: CreateAppointmentRequest, headers?: Record<string, string | undefined>): Promise<CreateAppointmentResponse>;
  getAppointmentById(id: string): Promise<AppointmentResource | null>;
  listAppointments(query: ListAppointmentsQuery): Promise<ListAppointmentsResponse>;
  cancelAppointment(id: string, body: CancelAppointmentBody): Promise<AppointmentResource>;
  markNoShow(id: string, body: MarkNoShowBody): Promise<AppointmentResource>;
}

const slotClient = buildSlotClient();

export class DbAppointmentService implements AppointmentService {
  constructor(private readonly repository: AppointmentRepository) {}

  async createAppointment(
    data: CreateAppointmentRequest,
    headers: Record<string, string | undefined> = {}
  ): Promise<CreateAppointmentResponse> {
    const idempotencyKey = headers['idempotency-key'];

    return withTransaction(async (tx) => {
      if (idempotencyKey) {
        const existingResponse = await getIdempotentResponse(tx, idempotencyKey);
        if (existingResponse) {
          return existingResponse as CreateAppointmentResponse;
        }
      }

      const reservation = await this.repository.lockReservationByToken(
        data.reservationToken,
        tx
      );

      if (!reservation) {
        throw new ConflictError('Reservation token not found or already consumed');
      }

      if (reservation.status !== 'locked' || (reservation.expiresAt && reservation.expiresAt < new Date())) {
        throw new ConflictError('Reservation token expired or already confirmed');
      }

      if (reservation.start.toISOString() !== data.start) {
        throw new ValidationError('Reservation slot mismatch');
      }

      await slotClient.validateReservationToken(data.reservationToken);

      const appointment = Appointment.schedule({
        reservationId: reservation.id,
        clientId: data.clientId,
        unitId: data.unitId,
        serviceId: data.serviceId,
        barberId: data.barberId ?? null,
        start: new Date(data.start),
        end: new Date(reservation.end.toISOString()),
        origin: data.origin,
        notes: data.notes ?? null
      });

      const persisted = await this.repository.create(appointment, tx);

      await this.repository.confirmReservation(reservation.id, tx);

      const response = persisted.toDTO(data.reservationToken);

      if (idempotencyKey) {
        await saveIdempotentResponse(tx, idempotencyKey, response);
      }

      await eventBus.publish({
        type: 'AppointmentCreated',
        payload: response
      });

      return response;
    });
  }

  async getAppointmentById(id: string): Promise<AppointmentResource | null> {
    const appointment = await this.repository.findById(id);
    return appointment ? appointment.toDTO() : null;
  }

  async listAppointments(query: ListAppointmentsQuery): Promise<ListAppointmentsResponse> {
    return this.repository.list(query);
  }

  async cancelAppointment(id: string, body: CancelAppointmentBody): Promise<AppointmentResource> {
    return withTransaction(async (tx) => {
      const appointment = await this.repository.findByIdForUpdate(id, tx);
      if (!appointment) {
        throw new NotFoundError('Appointment not found');
      }

      appointment.cancel(body.reason);
      const updated = await this.repository.update(appointment, tx);

      await eventBus.publish({
        type: 'AppointmentCancelled',
        payload: updated.toDTO()
      });

      return updated.toDTO();
    });
  }

  async markNoShow(id: string, body: MarkNoShowBody): Promise<AppointmentResource> {
    if (!['barbeiro', 'admin'].includes(body.markedBy)) {
      throw new UnauthorizedError('Only staff can mark no-show');
    }

    return withTransaction(async (tx) => {
      const appointment = await this.repository.findByIdForUpdate(id, tx);
      if (!appointment) {
        throw new NotFoundError('Appointment not found');
      }

      appointment.markNoShow();
      const updated = await this.repository.update(appointment, tx);

      await eventBus.publish({
        type: 'AppointmentNoShow',
        payload: updated.toDTO()
      });

      return updated.toDTO();
    });
  }
}

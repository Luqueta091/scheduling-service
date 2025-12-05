import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  eventBus,
  withTransaction,
  appointmentMetrics,
  runWithSpan
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
import type { UserRole } from '../../dtos/appointment.common';

export interface AppointmentService {
  createAppointment(data: CreateAppointmentRequest, headers?: Record<string, string | undefined>): Promise<CreateAppointmentResponse>;
  getAppointmentById(id: string): Promise<AppointmentResource | null>;
  listAppointments(query: ListAppointmentsQuery): Promise<ListAppointmentsResponse>;
  cancelAppointment(id: string, body: CancelAppointmentBody): Promise<AppointmentResource>;
  markNoShow(id: string, body: MarkNoShowBody, actorRole: StaffRole): Promise<AppointmentResource>;
}

const slotClient = buildSlotClient();

type StaffRole = Extract<UserRole, 'barbeiro' | 'admin'>;

export class DbAppointmentService implements AppointmentService {
  constructor(private readonly repository: AppointmentRepository) {}

  async createAppointment(
    data: CreateAppointmentRequest,
    headers: Record<string, string | undefined> = {}
  ): Promise<CreateAppointmentResponse> {
    return runWithSpan(
      'DbAppointmentService.createAppointment',
      async () => {
        const idempotencyKey = headers['idempotency-key'];
        const operationStart = process.hrtime.bigint();

        try {
          const response = await withTransaction(async (tx) => {
            if (idempotencyKey) {
              const existingResponse = await runWithSpan(
                'Idempotency.getResponse',
                () => getIdempotentResponse(tx, idempotencyKey),
                { 'idempotency.key': idempotencyKey }
              );
              if (existingResponse) {
                return existingResponse as CreateAppointmentResponse;
              }
            }

            const reservation = await runWithSpan(
              'Repository.lockReservationByToken',
              () => this.repository.lockReservationByToken(data.reservationToken, tx),
              { 'reservation.token': data.reservationToken }
            );

            if (!reservation) {
              throw new ConflictError('Reservation token not found or already consumed');
            }

            if (
              reservation.status !== 'locked' ||
              (reservation.expiresAt && reservation.expiresAt < new Date())
            ) {
              throw new ConflictError('Reservation token expired or already confirmed');
            }

            if (reservation.start.toISOString() !== data.start) {
              throw new ValidationError('Reservation slot mismatch');
            }

            await runWithSpan('SlotClient.validateReservationToken', () =>
              slotClient.validateReservationToken(data.reservationToken)
            );

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

            const persisted = await runWithSpan(
              'Repository.createAppointment',
              () => this.repository.create(appointment, tx),
              { 'appointment.id': appointment.toDTO().appointmentId }
            );

            await runWithSpan('Repository.confirmReservation', () =>
              this.repository.confirmReservation(reservation.id, tx)
            );

            const response = persisted.toDTO(data.reservationToken);

            if (idempotencyKey) {
              await runWithSpan(
                'Idempotency.saveResponse',
                () => saveIdempotentResponse(tx, idempotencyKey, response),
                { 'idempotency.key': idempotencyKey }
              );
            }

            await runWithSpan(
              'EventBus.publish',
              () =>
                eventBus.publish({
                  type: 'AppointmentCreated',
                  payload: response
                }),
              { eventType: 'AppointmentCreated' }
            );

            appointmentMetrics.created.inc();

            return response;
          });

          const durationSeconds = Number(process.hrtime.bigint() - operationStart) / 1_000_000_000;
          appointmentMetrics.creationDuration.observe(durationSeconds);

          return response;
        } catch (error) {
          if (error instanceof ConflictError) {
            appointmentMetrics.conflicts.inc();
          }
          const durationSeconds = Number(process.hrtime.bigint() - operationStart) / 1_000_000_000;
          appointmentMetrics.creationDuration.observe(durationSeconds);
          throw error;
        }
      },
      { 'reservation.token': data.reservationToken }
    );
  }

  async getAppointmentById(id: string): Promise<AppointmentResource | null> {
    const appointment = await this.repository.findById(id);
    return appointment ? appointment.toDTO() : null;
  }

  async listAppointments(query: ListAppointmentsQuery): Promise<ListAppointmentsResponse> {
    return this.repository.list(query);
  }

  async cancelAppointment(id: string, body: CancelAppointmentBody): Promise<AppointmentResource> {
    return runWithSpan(
      'DbAppointmentService.cancelAppointment',
      async () =>
        withTransaction(async (tx) => {
          const appointment = await runWithSpan(
            'Repository.findByIdForUpdate',
            () => this.repository.findByIdForUpdate(id, tx),
            { 'appointment.id': id }
          );
          if (!appointment) {
            throw new NotFoundError('Appointment not found');
          }

          appointment.cancel(body.reason);
          const updated = await runWithSpan('Repository.updateAppointment', () =>
            this.repository.update(appointment, tx)
          );

          await runWithSpan(
            'EventBus.publish',
            () =>
              eventBus.publish({
                type: 'AppointmentCancelled',
                payload: updated.toDTO()
              }),
            { eventType: 'AppointmentCancelled' }
          );

          appointmentMetrics.cancelled.inc();

          return updated.toDTO();
        }),
      { 'appointment.id': id }
    );
  }

  async markNoShow(
    id: string,
    body: MarkNoShowBody,
    actorRole: StaffRole
  ): Promise<AppointmentResource> {
    if (!['barbeiro', 'admin'].includes(actorRole)) {
      throw new UnauthorizedError('Only staff can mark no-show');
    }

    return runWithSpan(
      'DbAppointmentService.markNoShow',
      async () =>
        withTransaction(async (tx) => {
          const appointment = await runWithSpan(
            'Repository.findByIdForUpdate',
            () => this.repository.findByIdForUpdate(id, tx),
            { 'appointment.id': id }
          );
          if (!appointment) {
            throw new NotFoundError('Appointment not found');
          }

          appointment.markNoShow();
          const updated = await runWithSpan('Repository.updateAppointment', () =>
            this.repository.update(appointment, tx)
          );

          await runWithSpan(
            'EventBus.publish',
            () =>
              eventBus.publish({
                type: 'AppointmentNoShow',
                payload: {
                  ...updated.toDTO(),
                  markedBy: actorRole,
                  markedAt: body.timestamp ?? new Date().toISOString()
                }
              }),
            { eventType: 'AppointmentNoShow' }
          );

          appointmentMetrics.noShow.inc();

          return updated.toDTO();
        }),
      { 'appointment.id': id, actorRole }
    );
  }
}

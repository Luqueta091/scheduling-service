import type { PoolClient } from 'pg';

import type { Appointment } from '../domain/appointment';
import type {
  ListAppointmentsQuery,
  ListAppointmentsResponse
} from '../dtos';

export interface ReservationRecord {
  id: string;
  reservationToken: string;
  unitId: string;
  serviceId: string;
  barberId: string | null;
  start: Date;
  end: Date;
  status: string;
  expiresAt: Date | null;
}

export interface AppointmentRepository {
  create(appointment: Appointment, client: PoolClient): Promise<Appointment>;
  update(appointment: Appointment, client: PoolClient): Promise<Appointment>;
  findById(id: string, client?: PoolClient): Promise<Appointment | null>;
  findByIdForUpdate(id: string, client: PoolClient): Promise<Appointment | null>;
  findByReservationId(reservationId: string, client?: PoolClient): Promise<Appointment | null>;
  list(query: ListAppointmentsQuery): Promise<ListAppointmentsResponse>;
  lockReservationByToken(token: string, client: PoolClient): Promise<ReservationRecord | null>;
  confirmReservation(reservationId: string, client: PoolClient): Promise<void>;
}

import { randomUUID } from 'node:crypto';

import { ValidationError } from '@barbershop/shared';

import type { AppointmentResource, AppointmentStatus, UserRole } from '../dtos';

export interface AppointmentProps {
  id: string;
  reservationId: string;
  clientId: string;
  unitId: string;
  serviceId: string;
  barberId?: string | null;
  start: Date;
  end: Date;
  status: AppointmentStatus;
  origin: UserRole;
  notes?: string | null;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateAppointmentProperties = Omit<
  AppointmentProps,
  'id' | 'status' | 'createdAt' | 'updatedAt'
> & {
  id?: string;
  status?: AppointmentStatus;
  createdAt?: Date;
  updatedAt?: Date;
};

export class Appointment {
  private constructor(private readonly props: AppointmentProps) {}

  static schedule(properties: CreateAppointmentProperties): Appointment {
    const now = new Date();
    const start = new Date(properties.start);
    const end = new Date(properties.end);

    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
      throw new ValidationError('Invalid start or end date for appointment');
    }

    if (start >= end) {
      throw new ValidationError('Appointment end must be after start');
    }

    const appointment: AppointmentProps = {
      id: properties.id ?? randomUUID(),
      reservationId: properties.reservationId,
      clientId: properties.clientId,
      unitId: properties.unitId,
      serviceId: properties.serviceId,
      barberId: properties.barberId ?? null,
      start,
      end,
      status: properties.status ?? 'agendado',
      origin: properties.origin,
      notes: properties.notes ?? null,
      createdBy: properties.createdBy ?? null,
      createdAt: properties.createdAt ?? now,
      updatedAt: properties.updatedAt ?? now
    };

    return new Appointment(appointment);
  }

  static fromPersistence(row: AppointmentDatabaseRow): Appointment {
    return new Appointment({
      id: row.id,
      reservationId: row.reservation_id,
      clientId: row.client_id,
      unitId: row.unit_id,
      serviceId: row.service_id,
      barberId: row.barber_id,
      start: new Date(row.start_ts),
      end: new Date(row.end_ts),
      status: row.status as AppointmentStatus,
      origin: row.origin as UserRole,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    });
  }

  cancel(reason?: string): void {
    if (this.props.status === 'cancelado') {
      throw new ValidationError('Appointment already cancelled');
    }

    if (this.props.status === 'falta') {
      throw new ValidationError('Cannot cancel a no-show appointment');
    }

    this.props.status = 'cancelado';
    this.props.notes = reason ?? this.props.notes ?? null;
    this.touch();
  }

  markNoShow(): void {
    if (this.props.status !== 'agendado') {
      throw new ValidationError('Only scheduled appointments can be marked as no-show');
    }

    this.props.status = 'falta';
    this.touch();
  }

  toPersistence(): AppointmentDatabaseRow {
    return {
      id: this.props.id,
      reservation_id: this.props.reservationId,
      client_id: this.props.clientId,
      unit_id: this.props.unitId,
      service_id: this.props.serviceId,
      barber_id: this.props.barberId ?? null,
      start_ts: this.props.start.toISOString(),
      end_ts: this.props.end.toISOString(),
      status: this.props.status,
      origin: this.props.origin,
      notes: this.props.notes ?? null,
      created_by: this.props.createdBy ?? null,
      created_at: this.props.createdAt.toISOString(),
      updated_at: this.props.updatedAt.toISOString()
    };
  }

  toDTO(reservationToken?: string): AppointmentResource {
    return {
      appointmentId: this.props.id,
      clientId: this.props.clientId,
      unitId: this.props.unitId,
      serviceId: this.props.serviceId,
      barberId: this.props.barberId ?? undefined,
      start: this.props.start.toISOString(),
      end: this.props.end.toISOString(),
      status: this.props.status,
      origin: this.props.origin,
      reservationToken,
      notes: this.props.notes ?? undefined,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString()
    };
  }

  get propsSnapshot(): AppointmentProps {
    return { ...this.props };
  }

  private touch() {
    this.props.updatedAt = new Date();
  }
}

export interface AppointmentDatabaseRow {
  id: string;
  reservation_id: string;
  client_id: string;
  unit_id: string;
  service_id: string;
  barber_id: string | null;
  start_ts: string;
  end_ts: string;
  status: string;
  origin: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

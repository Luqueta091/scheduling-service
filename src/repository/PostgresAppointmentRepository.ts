import { getDb } from '@barbershop/shared';
import type { PoolClient, QueryResult } from 'pg';

import { Appointment, type AppointmentDatabaseRow } from '../domain/appointment';
import type { AppointmentRepository, ReservationRecord } from './IAppointmentRepository';
import type { ListAppointmentsQuery, ListAppointmentsResponse } from '../dtos';

const APPOINTMENT_COLUMNS = `
  id,
  reservation_id,
  client_id,
  unit_id,
  service_id,
  barber_id,
  start_ts,
  end_ts,
  status,
  origin,
  notes,
  created_by,
  created_at,
  updated_at
`;

const RESERVATION_COLUMNS = `
  id,
  reservation_token,
  unit_id,
  service_id,
  barber_id,
  start_ts,
  end_ts,
  status,
  expires_at
`;

function mapAppointmentRow(row: AppointmentDatabaseRow): Appointment {
  return Appointment.fromPersistence(row);
}

function mapReservationRow(row: any): ReservationRecord {
  return {
    id: row.id,
    reservationToken: row.reservation_token,
    unitId: row.unit_id,
    serviceId: row.service_id,
    barberId: row.barber_id,
    start: new Date(row.start_ts),
    end: new Date(row.end_ts),
    status: row.status,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null
  };
}

export class PostgresAppointmentRepository implements AppointmentRepository {
  async create(appointment: Appointment, client: PoolClient): Promise<Appointment> {
    const row = appointment.toPersistence();
    const result = await client.query<AppointmentDatabaseRow>(
      `INSERT INTO appointments (
        id,
        reservation_id,
        client_id,
        barber_id,
        unit_id,
        service_id,
        start_ts,
        end_ts,
        status,
        origin,
        notes,
        created_by,
        created_at,
        updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
      ) RETURNING ${APPOINTMENT_COLUMNS}`,
      [
        row.id,
        row.reservation_id,
        row.client_id,
        row.barber_id,
        row.unit_id,
        row.service_id,
        row.start_ts,
        row.end_ts,
        row.status,
        row.origin,
        row.notes,
        row.created_by,
        row.created_at,
        row.updated_at
      ]
    );

    return mapAppointmentRow(result.rows[0]);
  }

  async update(appointment: Appointment, client: PoolClient): Promise<Appointment> {
    const row = appointment.toPersistence();
    const result = await client.query<AppointmentDatabaseRow>(
      `UPDATE appointments
         SET client_id = $2,
             barber_id = $3,
             unit_id = $4,
             service_id = $5,
             start_ts = $6,
             end_ts = $7,
             status = $8,
             origin = $9,
             notes = $10,
             created_by = $11,
             updated_at = $12
       WHERE id = $1
       RETURNING ${APPOINTMENT_COLUMNS}`,
      [
        row.id,
        row.client_id,
        row.barber_id,
        row.unit_id,
        row.service_id,
        row.start_ts,
        row.end_ts,
        row.status,
        row.origin,
        row.notes,
        row.created_by,
        row.updated_at
      ]
    );

    if (result.rows.length === 0) {
      return appointment;
    }

    return mapAppointmentRow(result.rows[0]);
  }

  async findById(id: string, client?: PoolClient): Promise<Appointment | null> {
    const executor = client ?? getDb();
    const result = await executor.query<AppointmentDatabaseRow>(
      `SELECT ${APPOINTMENT_COLUMNS} FROM appointments WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;
    return mapAppointmentRow(result.rows[0]);
  }

  async findByIdForUpdate(id: string, client: PoolClient): Promise<Appointment | null> {
    const result = await client.query<AppointmentDatabaseRow>(
      `SELECT ${APPOINTMENT_COLUMNS}
         FROM appointments
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    if (result.rows.length === 0) return null;
    return mapAppointmentRow(result.rows[0]);
  }

  async findByReservationId(reservationId: string, client?: PoolClient): Promise<Appointment | null> {
    const executor = client ?? getDb();
    const result = await executor.query<AppointmentDatabaseRow>(
      `SELECT ${APPOINTMENT_COLUMNS} FROM appointments WHERE reservation_id = $1`,
      [reservationId]
    );

    if (result.rows.length === 0) return null;
    return mapAppointmentRow(result.rows[0]);
  }

  async list(query: ListAppointmentsQuery): Promise<ListAppointmentsResponse> {
    const filters: string[] = [];
    const params: any[] = [];

    if (query.clienteId) {
      params.push(query.clienteId);
      filters.push(`client_id = $${params.length}`);
    }

    if (query.barberId) {
      params.push(query.barberId);
      filters.push(`barber_id = $${params.length}`);
    }

    if (query.unitId) {
      params.push(query.unitId);
      filters.push(`unit_id = $${params.length}`);
    }

    if (query.date) {
      params.push(query.date);
      filters.push(`DATE(start_ts) = $${params.length}`);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    params.push(pageSize, offset);
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const listResult = await getDb().query<AppointmentDatabaseRow>(
      `SELECT ${APPOINTMENT_COLUMNS}
         FROM appointments
         ${whereClause}
        ORDER BY start_ts ASC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}`,
      params
    );

    const countResult = await getDb().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM appointments ${whereClause}`,
      params.slice(0, params.length - 2)
    );

    const items = listResult.rows.map(mapAppointmentRow).map((appointment) => appointment.toDTO());

    return {
      items,
      page,
      pageSize,
      total: Number(countResult.rows[0]?.count ?? 0)
    };
  }

  async lockReservationByToken(token: string, client: PoolClient): Promise<ReservationRecord | null> {
    const result = await client.query(
      `SELECT ${RESERVATION_COLUMNS}
         FROM reservations
        WHERE reservation_token = $1
        FOR UPDATE`,
      [token]
    );

    if (result.rows.length === 0) return null;
    return mapReservationRow(result.rows[0]);
  }

  async confirmReservation(reservationId: string, client: PoolClient): Promise<void> {
    await client.query(
      `UPDATE reservations
          SET status = 'confirmed',
              expires_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [reservationId]
    );
  }
}

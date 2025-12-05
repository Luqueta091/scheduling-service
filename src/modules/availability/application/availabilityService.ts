import { randomUUID } from 'node:crypto';

import {
  ValidationError,
  ConflictError,
  getDb,
  withTransaction,
  config,
  availabilityMetrics,
  runWithSpan,
  getEventBus,
  logger
} from '@barbershop/shared';
import type { PoolClient } from 'pg';

import {
  SLOT_LOCKED_EVENT,
  SLOT_RELEASED_EVENT,
  type SlotLockedEvent,
  type SlotReleasedEvent
} from '@barbershop/shared';

import type { AvailabilityResponse, SlotTemplate } from '../domain/models';

export interface ListAvailabilityParams {
  unitId: string;
  serviceId: string;
  date: string; // YYYY-MM-DD
}

export interface LockSlotInput {
  unitId: string;
  serviceId: string;
  start: string;
  end: string;
  barberId?: string | null;
}

export interface LockSlotResult {
  reservationToken: string;
  slotStart: string;
  slotEnd: string;
  expiresAt: string;
}

export class AvailabilityService {
  constructor(private readonly eventBus = getEventBus()) {}
  async listAvailability(params: ListAvailabilityParams): Promise<AvailabilityResponse> {
    return runWithSpan(
      'AvailabilityService.listAvailability',
      async () => {
        const { unitId, serviceId, date } = params;
        const dayDate = this.parseDate(date);
        const weekday = dayDate.getUTCDay();
        const templates = await this.fetchTemplates(unitId, serviceId, weekday);

        if (templates.length === 0) {
          return {
            unitId,
            serviceId,
            date,
            slots: []
          };
        }

        const dayStart = dayDate;
        const dayEnd = new Date(dayStart.getTime() + 86_400_000);
        const [reservationCounts, appointmentSet] = await Promise.all([
          this.fetchReservationCounts(unitId, serviceId, dayStart, dayEnd),
          this.fetchAppointments(unitId, serviceId, dayStart, dayEnd)
        ]);

        const slots = templates.flatMap((template) => {
          const generated = this.generateSlotsForTemplate(template, dayStart);

          return generated.map((slot) => {
            const slotKey = slot.start;
            const appointmentsCount = appointmentSet.has(slotKey) ? slot.capacity : 0;
            const lockedCount = reservationCounts.get(slotKey) ?? 0;
            const taken = appointmentsCount + lockedCount;
            const remaining = Math.max(slot.capacity - taken, 0);

            return {
              start: slot.start,
              end: slot.end,
              capacity: slot.capacity,
              remainingCapacity: remaining,
              available: remaining > 0
            };
          });
        });

        slots.sort((a, b) => a.start.localeCompare(b.start));

        return {
          unitId,
          serviceId,
          date,
          slots
        };
      },
      params
    );
  }

  async lockSlot(input: LockSlotInput): Promise<LockSlotResult> {
    availabilityMetrics.lockAttempts.inc();
    return runWithSpan(
      'AvailabilityService.lockSlot',
      async () =>
        withTransaction(async (client) => {
          const normalized = this.validateSlotRequest(input);
          const { template, currentCount } = await this.ensureSlotMatchesTemplate(
            normalized,
            client
          );
          await this.ensureNoAppointment(normalized, client);

          const expiresAt = new Date(Date.now() + config.RESERVATION_TTL * 1000);
          const reservationToken = `resv_${randomUUID()}`;

          try {
            await client.query(
              `INSERT INTO reservations (
                reservation_token,
                unit_id,
                service_id,
                barber_id,
                start_ts,
                end_ts,
                status,
                expires_at
              ) VALUES ($1,$2,$3,$4,$5,$6,'locked',$7)`,
              [
                reservationToken,
                normalized.unitId,
                normalized.serviceId,
                normalized.barberId,
                normalized.start,
                normalized.end,
                expiresAt.toISOString()
              ]
            );
          } catch (error: any) {
            if (error?.code === '23505') {
              availabilityMetrics.lockConflicts.inc();
              throw new ConflictError('Slot already locked');
            }
            throw error;
          }

          availabilityMetrics.lockSuccess.inc();

          const capacityUsed = await this.countActiveReservations(
            normalized.unitId,
            normalized.serviceId,
            normalized.start,
            client
          );

          await this.emitSlotLockedEvent({
            slotStart: normalized.start,
            slotEnd: normalized.end,
            unitId: normalized.unitId,
            serviceId: normalized.serviceId,
            reservationToken,
            capacityTotal: template.capacityPerSlot,
            capacityUsed
          });

          return {
            reservationToken,
            slotStart: normalized.start.toISOString(),
            slotEnd: normalized.end.toISOString(),
            expiresAt: expiresAt.toISOString()
          };
        }),
      input
    );
  }

  async releaseSlot(
    reservationToken: string,
    reason: SlotReleasedEvent['reason'] = 'manual'
  ): Promise<void> {
    return runWithSpan(
      'AvailabilityService.releaseSlot',
      async () =>
        withTransaction(async (client) => {
          const reservationResult = await client.query(
            `SELECT id,
                    unit_id,
                    service_id,
                    start_ts,
                    end_ts
               FROM reservations
              WHERE reservation_token = $1
                AND status = 'locked'
              FOR UPDATE`,
            [reservationToken]
          );

          if (reservationResult.rows.length === 0) {
            throw new ConflictError('Reservation already released or not found');
          }

          const reservation = reservationResult.rows[0];

          await client.query(
            `UPDATE reservations
                SET status = 'released',
                    updated_at = now()
              WHERE reservation_token = $1`,
            [reservationToken]
          );

          availabilityMetrics.lockExpired.inc();

          const capacityUsed = await this.countActiveReservations(
            reservation.unit_id,
            reservation.service_id,
            new Date(reservation.start_ts),
            client
          );

          const template =
            (await this.findTemplateForSlot(
              reservation.unit_id,
              reservation.service_id,
              new Date(reservation.start_ts)
            )) ?? null;
          const capacityTotal = template?.capacityPerSlot ?? Math.max(capacityUsed, 1);

          await this.emitSlotReleasedEvent({
            reservationToken,
            unitId: reservation.unit_id,
            serviceId: reservation.service_id,
            slotStart: new Date(reservation.start_ts),
            slotEnd: new Date(reservation.end_ts),
            capacityUsed,
            capacityTotal,
            reason
          });
        }),
      { reservationToken }
    );
  }

  private parseDate(date: string): Date {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf())) {
      throw new ValidationError('Invalid date format, expected YYYY-MM-DD');
    }
    return parsed;
  }

  private async fetchTemplates(
    unitId: string,
    serviceId: string,
    weekday: number
  ): Promise<SlotTemplate[]> {
    const { rows } = await getDb().query(
      `SELECT id,
              unit_id,
              service_id,
              barber_id,
              weekday,
              start_time,
              end_time,
              slot_duration_minutes,
              buffer_minutes,
              capacity_per_slot
         FROM availability_slot_templates
        WHERE unit_id = $1
          AND service_id = $2
          AND weekday = $3`,
      [unitId, serviceId, weekday]
    );

    return rows.map((row) => ({
      id: row.id,
      unitId: row.unit_id,
      serviceId: row.service_id,
      barberId: row.barber_id,
      weekday: row.weekday,
      startTime: row.start_time,
      endTime: row.end_time,
      slotDurationMinutes: row.slot_duration_minutes,
      bufferMinutes: row.buffer_minutes,
      capacityPerSlot: row.capacity_per_slot
    }));
  }

  private generateSlotsForTemplate(template: SlotTemplate, dayStart: Date) {
    const slots: Array<{ start: string; end: string }> = [];
    let cursor = this.combineDateAndTime(dayStart, template.startTime);
    const templateEnd = this.combineDateAndTime(dayStart, template.endTime);

    while (cursor < templateEnd) {
      const slotEnd = new Date(cursor.getTime() + template.slotDurationMinutes * 60_000);
      if (slotEnd > templateEnd) {
        break;
      }

      slots.push({
        start: cursor.toISOString(),
        end: slotEnd.toISOString()
      });

      cursor = new Date(
        cursor.getTime() + (template.slotDurationMinutes + template.bufferMinutes) * 60_000
      );
    }

    return slots.map((slot) => ({
      ...slot,
      capacity: template.capacityPerSlot
    }));
  }

  private combineDateAndTime(date: Date, time: string): Date {
    const [hoursStr, minutesStr, secondsStr] = time.split(':');
    const d = new Date(date.getTime());
    d.setUTCHours(Number(hoursStr), Number(minutesStr ?? '0'), Number(secondsStr ?? '0'), 0);
    return d;
  }

  private async fetchReservationCounts(
    unitId: string,
    serviceId: string,
    dayStart: Date,
    dayEnd: Date
  ): Promise<Map<string, number>> {
    const { rows } = await getDb().query(
      `SELECT start_ts
         FROM reservations
        WHERE unit_id = $1
          AND service_id = $2
          AND start_ts >= $3
          AND start_ts < $4
          AND status IN ('locked', 'confirmed')`,
      [unitId, serviceId, dayStart.toISOString(), dayEnd.toISOString()]
    );

    const map = new Map<string, number>();
    for (const row of rows) {
      const key = new Date(row.start_ts).toISOString();
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }

  private async fetchAppointments(
    unitId: string,
    serviceId: string,
    dayStart: Date,
    dayEnd: Date
  ): Promise<Set<string>> {
    const { rows } = await getDb().query(
      `SELECT start_ts
         FROM appointments
        WHERE unit_id = $1
          AND service_id = $2
          AND start_ts >= $3
          AND start_ts < $4
          AND status = 'agendado'`,
      [unitId, serviceId, dayStart.toISOString(), dayEnd.toISOString()]
    );

    const set = new Set<string>();
    for (const row of rows) {
      set.add(new Date(row.start_ts).toISOString());
    }
    return set;
  }

  private validateSlotRequest(input: LockSlotInput) {
    const start = new Date(input.start);
    const end = new Date(input.end);
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
      throw new ValidationError('Invalid slot interval');
    }
    if (start >= end) {
      throw new ValidationError('Slot end must be after start');
    }

    return {
      ...input,
      start,
      end,
      barberId: input.barberId ?? null
    };
  }

  private async ensureSlotMatchesTemplate(
    slot: ReturnType<AvailabilityService['validateSlotRequest']>,
    client: PoolClient
  ): Promise<{ template: SlotTemplate; currentCount: number }> {
    const template = await this.findTemplateForSlot(slot.unitId, slot.serviceId, slot.start);

    if (!template) {
      throw new ValidationError('Slot not allowed for the configured templates');
    }

    const currentCount = await this.countActiveReservations(
      slot.unitId,
      slot.serviceId,
      slot.start,
      client
    );

    if (currentCount >= template.capacityPerSlot) {
      availabilityMetrics.lockConflicts.inc();
      throw new ConflictError('Slot already reserved');
    }

    return { template, currentCount };
  }

  private async ensureNoAppointment(
    slot: ReturnType<AvailabilityService['validateSlotRequest']>,
    client: PoolClient
  ): Promise<void> {
    const conflict = await client.query(
      `SELECT 1
         FROM appointments
        WHERE unit_id = $1
          AND service_id = $2
          AND start_ts = $3
          AND status = 'agendado'
        LIMIT 1`,
      [slot.unitId, slot.serviceId, slot.start.toISOString()]
    );

    if (conflict.rowCount) {
      availabilityMetrics.lockConflicts.inc();
      throw new ConflictError('Slot already booked');
    }
  }

  private async findTemplateForSlot(
    unitId: string,
    serviceId: string,
    slotStart: Date
  ): Promise<SlotTemplate | null> {
    const weekday = slotStart.getUTCDay();
    const templates = await this.fetchTemplates(unitId, serviceId, weekday);
    if (templates.length === 0) {
      return null;
    }

    const dayReference = this.startOfDay(slotStart);

    return (
      templates.find((template) => {
        const generated = this.generateSlotsForTemplate(template, dayReference);
        return generated.some((item) => item.start === slotStart.toISOString());
      }) ?? null
    );
  }

  private async countActiveReservations(
    unitId: string,
    serviceId: string,
    slotStart: Date,
    client?: PoolClient
  ): Promise<number> {
    const executor = client ?? getDb();
    const { rows } = await executor.query(
      `SELECT COUNT(*) AS total
         FROM reservations
        WHERE unit_id = $1
          AND service_id = $2
          AND start_ts = $3
          AND status IN ('locked', 'confirmed')`,
      [unitId, serviceId, slotStart.toISOString()]
    );

    return Number(rows[0]?.total ?? 0);
  }

  private buildSlotEventPayload(args: {
    reservationToken: string;
    unitId: string;
    serviceId: string;
    slotStart: Date;
    slotEnd: Date;
    capacityTotal: number;
    capacityUsed: number;
  }): SlotLockedEvent {
    return {
      reservationToken: args.reservationToken,
      unitId: args.unitId,
      serviceId: args.serviceId,
      date: this.formatDate(args.slotStart),
      startTime: this.formatTime(args.slotStart),
      endTime: this.formatTime(args.slotEnd),
      capacityTotal: args.capacityTotal,
      capacityUsed: args.capacityUsed
    };
  }

  private async emitSlotLockedEvent(args: {
    reservationToken: string;
    unitId: string;
    serviceId: string;
    slotStart: Date;
    slotEnd: Date;
    capacityTotal: number;
    capacityUsed: number;
  }): Promise<void> {
    const payload = this.buildSlotEventPayload({
      reservationToken: args.reservationToken,
      unitId: args.unitId,
      serviceId: args.serviceId,
      slotStart: args.slotStart,
      slotEnd: args.slotEnd,
      capacityTotal: args.capacityTotal,
      capacityUsed: args.capacityUsed
    });

    try {
      await this.eventBus.publish(SLOT_LOCKED_EVENT, payload);
    } catch (error) {
      logger.warn(
        { error, event: SLOT_LOCKED_EVENT, reservationToken: args.reservationToken },
        'Failed to publish slot.locked event'
      );
    }
  }

  private async emitSlotReleasedEvent(args: {
    reservationToken: string;
    unitId: string;
    serviceId: string;
    slotStart: Date;
    slotEnd: Date;
    capacityUsed: number;
    capacityTotal: number;
    reason: SlotReleasedEvent['reason'];
  }): Promise<void> {
    const basePayload = this.buildSlotEventPayload({
      reservationToken: args.reservationToken,
      unitId: args.unitId,
      serviceId: args.serviceId,
      slotStart: args.slotStart,
      slotEnd: args.slotEnd,
      capacityTotal: args.capacityTotal,
      capacityUsed: args.capacityUsed
    });

    const payload: SlotReleasedEvent = {
      ...basePayload,
      reason: args.reason
    };

    try {
      await this.eventBus.publish(SLOT_RELEASED_EVENT, payload);
    } catch (error) {
      logger.warn(
        { error, event: SLOT_RELEASED_EVENT, reservationToken: args.reservationToken },
        'Failed to publish slot.released event'
      );
    }
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private formatTime(date: Date): string {
    return date.toISOString().slice(11, 16);
  }

  private startOfDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  }
}

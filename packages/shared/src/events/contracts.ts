export const SLOT_LOCKED_EVENT = 'slot.locked';
export const SLOT_RELEASED_EVENT = 'slot.released';

export interface SlotLockedEvent {
  reservationToken: string;
  unitId: string;
  serviceId: string;
  date: string;
  startTime: string;
  endTime: string;
  capacityTotal: number;
  capacityUsed: number;
}

export interface SlotReleasedEvent extends SlotLockedEvent {
  reason: 'cancelled' | 'expired' | 'manual';
}

export const APPOINTMENT_CREATED_EVENT = 'appointment.created';
export const APPOINTMENT_CANCELLED_EVENT = 'appointment.cancelled';
export const APPOINTMENT_NO_SHOW_EVENT = 'appointment.no_show';

export interface AppointmentCreatedEvent {
  appointmentId: string;
  unitId: string;
  serviceId: string;
  clientId: string;
  barberId: string | null;
  scheduledAt: string;
  reservationToken?: string;
}

export interface AppointmentCancelledEvent {
  appointmentId: string;
  unitId: string;
  serviceId: string;
  cancelledAt: string;
  reason?: string | null;
}

export interface AppointmentNoShowEvent {
  appointmentId: string;
  unitId: string;
  serviceId: string;
  occurredAt: string;
  actorRole?: string;
}

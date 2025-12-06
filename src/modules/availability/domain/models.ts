export interface SlotTemplate {
  id: string;
  unitId: string;
  serviceId: string;
  barberId: string | null;
  weekday: number; // 0 (domingo) ... 6 (sábado)
  startTime: string; // HH:MM:SS
  endTime: string; // HH:MM:SS
  slotDurationMinutes: number;
  bufferMinutes: number;
  capacityPerSlot: number;
}

export interface AvailabilitySlot {
  start: string;
  end: string;
  available: boolean;
  capacity: number;
  remainingCapacity: number;
}

export interface AvailabilityResponse {
  unitId: string;
  serviceId: string;
  date: string;
  slots: AvailabilitySlot[];
}

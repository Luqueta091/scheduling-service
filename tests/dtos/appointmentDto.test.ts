import { describe, expect, it } from 'vitest';

import {
  appointmentResourceSchema,
  createAppointmentRequestSchema,
  listAppointmentsQuerySchema
} from '../../src/dtos';

describe('appointment DTO schemas', () => {
  const baseRequest = {
    clientId: 'ef8730bd-8dbe-45b6-b5b4-2cb4c2ff01d8',
    unitId: 'a3d932ae-f23c-4ce5-9ed3-2f2eca4a0df8',
    serviceId: '5b6ad154-42d8-4a73-8c23-5ce77e9d0b74',
    barberId: 'e5a7b492-991a-4e54-892d-8c4191dcf689',
    start: '2025-12-03T15:00:00Z',
    reservationToken: 'resv_tok_abcdef123456',
    origin: 'cliente' as const
  };

  it('validates create appointment request', () => {
    const parsed = createAppointmentRequestSchema.parse(baseRequest);
    expect(parsed).toEqual(baseRequest);
  });

  it('rejects invalid uuid fields', () => {
    expect(() =>
      createAppointmentRequestSchema.parse({
        ...baseRequest,
        clientId: 'not-a-uuid'
      })
    ).toThrow();
  });

  it('parses list query defaults', () => {
    const parsed = listAppointmentsQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
  });

  it('maps appointment resource schema', () => {
    const resource = appointmentResourceSchema.parse({
      appointmentId: 'a2f63131-b103-4ba5-ac6a-f6b4023f8783',
      clientId: baseRequest.clientId,
      unitId: baseRequest.unitId,
      serviceId: baseRequest.serviceId,
      barberId: baseRequest.barberId,
      start: baseRequest.start,
      end: '2025-12-03T15:30:00Z',
      status: 'agendado',
      origin: 'cliente',
      reservationToken: baseRequest.reservationToken,
      notes: 'Observação',
      createdAt: '2025-12-03T14:50:00Z',
      updatedAt: '2025-12-03T14:50:00Z'
    });

    expect(resource.status).toBe('agendado');
  });
});

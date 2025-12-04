import { z } from 'zod';

import { appointmentStatusSchema, userRoleSchema } from './appointment.common';

const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime();

export const appointmentResourceSchema = z.object({
  appointmentId: uuidSchema,
  clientId: uuidSchema,
  unitId: uuidSchema,
  serviceId: uuidSchema,
  barberId: uuidSchema.nullish(),
  start: isoDateTimeSchema,
  end: isoDateTimeSchema,
  status: appointmentStatusSchema,
  origin: userRoleSchema,
  reservationToken: z.string().min(1).optional(),
  notes: z.string().max(500).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
});

export const createAppointmentRequestSchema = z.object({
  clientId: uuidSchema,
  unitId: uuidSchema,
  serviceId: uuidSchema,
  barberId: uuidSchema.nullish(),
  start: isoDateTimeSchema,
  reservationToken: z.string().min(1),
  origin: userRoleSchema,
  notes: z.string().max(500).optional()
});

export const createAppointmentResponseSchema = appointmentResourceSchema;

export type AppointmentResource = z.infer<typeof appointmentResourceSchema>;
export type CreateAppointmentRequest = z.infer<typeof createAppointmentRequestSchema>;
export type CreateAppointmentResponse = z.infer<typeof createAppointmentResponseSchema>;

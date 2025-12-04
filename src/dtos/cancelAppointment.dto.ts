import { z } from 'zod';

import { appointmentResourceSchema } from './createAppointment.dto';

const uuidSchema = z.string().uuid();

export const cancelAppointmentParamsSchema = z.object({
  id: uuidSchema
});

export const cancelAppointmentBodySchema = z.object({
  reason: z.string().trim().min(1).max(280)
});

export const cancelAppointmentResponseSchema = appointmentResourceSchema;

export type CancelAppointmentParams = z.infer<typeof cancelAppointmentParamsSchema>;
export type CancelAppointmentBody = z.infer<typeof cancelAppointmentBodySchema>;

import { z } from 'zod';

import { appointmentResourceSchema } from './createAppointment.dto';

const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().date();

export const getAppointmentParamsSchema = z.object({
  id: uuidSchema
});

export const listAppointmentsQuerySchema = z.object({
  clienteId: uuidSchema.optional(),
  barberId: uuidSchema.optional(),
  unitId: uuidSchema.optional(),
  date: isoDateSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const listAppointmentsResponseSchema = z.object({
  items: z.array(appointmentResourceSchema),
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative()
});

export type GetAppointmentParams = z.infer<typeof getAppointmentParamsSchema>;
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;
export type ListAppointmentsResponse = z.infer<typeof listAppointmentsResponseSchema>;

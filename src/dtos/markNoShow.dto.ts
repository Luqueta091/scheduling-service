import { z } from 'zod';

import { appointmentResourceSchema } from './createAppointment.dto';
import { appointmentStatusSchema, userRoleSchema } from './appointment.common';

const uuidSchema = z.string().uuid();
const isoDateTimeSchema = z.string().datetime();

export const markNoShowParamsSchema = z.object({
  id: uuidSchema
});

export const markNoShowBodySchema = z.object({
  markedBy: userRoleSchema,
  timestamp: isoDateTimeSchema
});

export const markNoShowResponseSchema = appointmentResourceSchema.extend({
  status: appointmentStatusSchema.default('falta')
});

export type MarkNoShowParams = z.infer<typeof markNoShowParamsSchema>;
export type MarkNoShowBody = z.infer<typeof markNoShowBodySchema>;

import { z } from 'zod';

import { appointmentResourceSchema } from './createAppointment.dto';
import { appointmentStatusSchema } from './appointment.common';

const uuidSchema = z.string().uuid();

export const updateAppointmentStatusParamsSchema = z.object({
  id: uuidSchema
});

export const updateAppointmentStatusBodySchema = z.object({
  status: appointmentStatusSchema
});

export const updateAppointmentStatusResponseSchema = appointmentResourceSchema;

export type UpdateAppointmentStatusParams = z.infer<typeof updateAppointmentStatusParamsSchema>;
export type UpdateAppointmentStatusBody = z.infer<typeof updateAppointmentStatusBodySchema>;

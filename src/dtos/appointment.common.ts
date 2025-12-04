import { z } from 'zod';

export const appointmentStatusSchema = z.enum(['agendado', 'cancelado', 'falta']);

export const userRoleSchema = z.enum(['cliente', 'barbeiro', 'admin']);

export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;
export type UserRole = z.infer<typeof userRoleSchema>;

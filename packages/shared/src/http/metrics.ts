import type { Request, Response, NextFunction } from 'express';
import { Router } from 'express';
import client, { Counter, Gauge } from 'prom-client';

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status']
});

register.registerMetric(httpRequestDuration);

const appointmentCreationDuration = new client.Histogram({
  name: 'appointment_creation_duration_seconds',
  help: 'Latência completa da criação de agendamento em segundos',
  buckets: [0.025, 0.05, 0.1, 0.2, 0.5, 1, 3, 5]
});

register.registerMetric(appointmentCreationDuration);

export const metricsRouter = Router();

metricsRouter.get('/metrics', async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', register.contentType);
  res.status(200).send(await register.metrics());
});

export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSeconds = durationNs / 1_000_000_000;

    httpRequestDuration
      .labels(req.method, req.route?.path ?? req.path, String(res.statusCode))
      .observe(durationSeconds);
  });

  next();
}

export const metrics = {
  register,
  httpRequestDuration
};

const appointmentsCreated = new Counter({
  name: 'appointments_created_total',
  help: 'Total de agendamentos criados'
});
const appointmentsCancelled = new Counter({
  name: 'appointments_cancelled_total',
  help: 'Total de agendamentos cancelados'
});
const appointmentsNoShow = new Counter({
  name: 'appointments_no_show_total',
  help: 'Total de agendamentos marcados como falta'
});
const appointmentsConflicts = new Counter({
  name: 'appointments_conflicts_total',
  help: 'Total de conflitos ao criar agendamentos'
});

register.registerMetric(appointmentsCreated);
register.registerMetric(appointmentsCancelled);
register.registerMetric(appointmentsNoShow);
register.registerMetric(appointmentsConflicts);

const slotServiceHealthGauge = new Gauge({
  name: 'slot_service_health',
  help: 'Saúde do Slot Service (1=ok, 0.5=degraded, 0=down)',
  labelNames: ['status']
});

register.registerMetric(slotServiceHealthGauge);

const SLOT_STATES = ['ok', 'degraded', 'down'] as const;
export type SlotServiceHealthStatus = (typeof SLOT_STATES)[number];

export const appointmentMetrics = {
  created: appointmentsCreated,
  cancelled: appointmentsCancelled,
  noShow: appointmentsNoShow,
  conflicts: appointmentsConflicts,
  creationDuration: appointmentCreationDuration
};

export function observeAppointmentCreation(durationSeconds: number): void {
  appointmentCreationDuration.observe(durationSeconds);
}

export function updateSlotServiceHealth(status: SlotServiceHealthStatus): void {
  for (const option of SLOT_STATES) {
    slotServiceHealthGauge.set({ status: option }, option === status ? 1 : 0);
  }
}

export function resetAllMetrics(): void {
  register.resetMetrics();
}

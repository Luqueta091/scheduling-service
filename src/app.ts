import path from 'node:path';
import type { IncomingMessage } from 'http';
import type { Level } from 'pino';
import type { Request, Response } from 'express';
import express from 'express';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

import {
  config,
  logger,
  metricsRouter,
  metricsMiddleware,
  traceMiddleware,
  getCurrentTraceId
} from '@barbershop/shared';

import { createAppointmentController } from './controllers/appointmentController';
import { DbAppointmentService } from './application/services/appointmentService';
import { PostgresAppointmentRepository } from './repository/PostgresAppointmentRepository';
import { errorMapper } from './infrastructure/http/errorMapper';
import { UserRepository } from './repository/UserRepository';
import { AuthService } from './application/services/authService';
import { createAuthController } from './controllers/authController';
import { createAuthMiddleware } from './infrastructure/http/authMiddleware';

const openApiPath = path.resolve(process.cwd(), 'docs/openapi.yaml');
let openApiDocument: unknown;

try {
  openApiDocument = YAML.load(openApiPath);
} catch (error) {
  logger.warn({ error, openApiPath }, 'Failed to load OpenAPI document');
}

export function createApp() {
  const app = express();
  const appointmentRepository = new PostgresAppointmentRepository();
  const appointmentService = new DbAppointmentService(appointmentRepository);
  const userRepository = new UserRepository();
  const authService = new AuthService(userRepository);
  const authMiddleware = createAuthMiddleware(authService);

  app.use(traceMiddleware);
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use(
    pinoHttp({
      logger,
      customLogLevel: (
        _req: IncomingMessage,
        res: Response,
        err: Error | undefined
      ): Level => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      }
    })
  );

  app.use((req, res, next) => {
    const reservationToken = req.header('x-reservation-token') ?? undefined;
    const traceId = getCurrentTraceId();
    const contextFields = {
      reservationToken,
      traceId
    } as const;
    res.locals.logContext = contextFields;
    res.locals.logger = logger.withContext(contextFields);
    res.locals.logger.info({ method: req.method, path: req.path }, 'Incoming request');
    next();
  });

  if (config.METRICS_ENABLED) {
    app.use(metricsMiddleware);
    app.use(metricsRouter);
  }

  if (openApiDocument) {
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  }

  app.use('/auth', createAuthController(authService));
  app.use(createAppointmentController({ service: appointmentService, auth: authMiddleware }));

  app.get('/health', (req: Request, res: Response) => {
    const reservationToken = req.header('x-reservation-token') ?? undefined;
    const reqLogger = res.locals.logger ?? logger.withContext({ reservationToken });
    reqLogger.info('Health check endpoint accessed');

    res.status(200).json({
      status: 'ok',
      service: config.SERVICE_NAME,
      version: config.NODE_ENV
    });
  });

  app.use(errorMapper);

  return app;
}

const defaultApp = createApp();

export default defaultApp;

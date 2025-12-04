import pino, { type Logger, type LoggerOptions } from 'pino';

import { config } from '../config';

export type ContextFields = {
  reservationToken?: string;
  userId?: string;
  [key: string]: unknown;
};

export interface SharedLogger extends Logger {
  withContext(context: ContextFields): SharedLogger;
}

function attachContextAPI(base: Logger): SharedLogger {
  const contextual = base as SharedLogger;
  contextual.withContext = (context: ContextFields) => attachContextAPI(base.child(context));
  return contextual;
}

export function createLogger(options: LoggerOptions = {}): SharedLogger {
  const base = pino({
    level: config.LOG_LEVEL,
    base: {
      service: config.SERVICE_NAME
    },
    ...options
  });

  return attachContextAPI(base);
}

export const logger = createLogger();

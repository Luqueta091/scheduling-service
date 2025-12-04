import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  AppError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
  logger
} from '@barbershop/shared';

interface ErrorResponseBody {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

function mapStatusCode(error: unknown): number {
  if (error instanceof ZodError) return 422;
  if (error instanceof ValidationError) return 422;
  if (error instanceof ConflictError) return 409;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof UnauthorizedError) return 401;
  if (error instanceof AppError) return error.status;
  return 500;
}

export function errorMapper(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const reservationToken = req.header('x-reservation-token') ?? undefined;
  const status = mapStatusCode(err);

  logger
    .withContext({ reservationToken })
    .error({ err, status, path: req.path, method: req.method }, 'Request failed');

  if (res.headersSent) {
    return;
  }

  const message =
    err instanceof Error ? err.message : 'Unexpected error while processing request';
  const body: ErrorResponseBody = {
    error:
      err instanceof AppError
        ? err.name
        : err instanceof ZodError
          ? 'ValidationError'
          : 'InternalServerError',
    message
  };

  if (err instanceof AppError && err.details) {
    body.details = err.details;
  }

  if (err instanceof ZodError) {
    body.details = { issues: err.issues };
  }

  res.status(status).json(body);
}

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import type { OutgoingHttpHeader, OutgoingHttpHeaders } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

import { config } from '../config';
import { logger } from '../logger';

type SpanStatus = 'ok' | 'error';

interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  attributes: Record<string, unknown>;
  start: [number, number];
}

const traceStore = new AsyncLocalStorage<SpanContext>();

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

function now(): [number, number] {
  return process.hrtime();
}

function durationMs(start: [number, number]): number {
  const [sec, nanosec] = process.hrtime(start);
  return sec * 1000 + nanosec / 1_000_000;
}

function createSpan(
  name: string,
  attributes: Record<string, unknown> = {},
  overrides?: { traceId?: string; parentSpanId?: string }
): SpanContext {
  const parent = traceStore.getStore();
  const traceId = overrides?.traceId ?? parent?.traceId ?? generateTraceId();
  const parentSpanId = overrides?.parentSpanId ?? parent?.spanId;

  return {
    traceId,
    spanId: generateSpanId(),
    parentSpanId,
    name,
    attributes,
    start: now()
  };
}

function finishSpan(span: SpanContext, status: SpanStatus): void {
  const elapsed = durationMs(span.start);
  const payload = {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    status,
    durationMs: elapsed,
    attributes: span.attributes
  };

  if (config.TRACING_EXPORT_JSON) {
    logger.info(payload, 'trace.span');
  } else {
    logger.debug(payload, 'trace.span');
  }
}

export async function runWithSpan<T>(
  name: string,
  handler: () => Promise<T>,
  attributes: Record<string, unknown> = {}
): Promise<T> {
  const span = createSpan(name, attributes);

  return traceStore.run(span, async () => {
    try {
      const result = await handler();
      finishSpan(span, 'ok');
      return result;
    } catch (error) {
      finishSpan(span, 'error');
      throw error;
    }
  });
}

export function getCurrentTraceId(): string | undefined {
  return traceStore.getStore()?.traceId;
}

export function getCurrentSpanId(): string | undefined {
  return traceStore.getStore()?.spanId;
}

export function traceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingTraceId = req.header('x-trace-id') ?? undefined;
  const incomingParentSpanId = req.header('x-span-parent') ?? undefined;

  const span = createSpan(
    `HTTP ${req.method} ${req.path}`,
    {
      'http.method': req.method,
      'http.route': req.route?.path ?? req.path,
      'http.target': req.originalUrl
    },
    {
      traceId: incomingTraceId,
      parentSpanId: incomingParentSpanId
    }
  );

  traceStore.run(span, () => {
    res.setHeader('x-trace-id', span.traceId);
    res.setHeader('x-span-parent', span.spanId);

    const originalWriteHead = res.writeHead;
    let headersCommitted = false;

    const ensureResponseTimeHeader = (): void => {
      if (headersCommitted) {
        return;
      }
      headersCommitted = true;

      if (!res.headersSent) {
        const elapsed = durationMs(span.start);
        res.setHeader('x-response-time', elapsed.toFixed(2));
      }
    };

    const patchedWriteHead = function patchedWriteHead(
      this: Response,
      statusCode: number,
      statusMessage?: string | OutgoingHttpHeaders | OutgoingHttpHeader[],
      headers?: OutgoingHttpHeaders | OutgoingHttpHeader[]
    ): ReturnType<typeof originalWriteHead> {
      ensureResponseTimeHeader();
      res.writeHead = originalWriteHead;
      const args: unknown[] = [statusCode];

      if (typeof statusMessage !== 'undefined') {
        args.push(statusMessage);
      }

      if (typeof headers !== 'undefined') {
        args.push(headers);
      }

      return originalWriteHead.apply(this, args as Parameters<typeof originalWriteHead>);
    } as typeof res.writeHead;

    res.writeHead = patchedWriteHead;

    res.on('finish', () => {
      const elapsed = durationMs(span.start);
      ensureResponseTimeHeader();

      span.attributes['http.status_code'] = res.statusCode;
      span.attributes['http.response_content_length'] =
        res.getHeader('content-length') ?? undefined;

      const status: SpanStatus = res.statusCode >= 500 ? 'error' : 'ok';
      const contextualLogger = logger.withContext({ traceId: span.traceId });
      contextualLogger.info(
        {
          method: req.method,
          route: req.originalUrl,
          status: res.statusCode,
          durationMs: elapsed
        },
        'Request completed'
      );

      finishSpan(span, status);
    });

    next();
  });
}

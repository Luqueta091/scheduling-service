import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const DEFAULT_MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

loadDotenv();

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_MAX_POOL: z.coerce.number().int().positive().optional(),
    RESERVATION_TTL: z.coerce.number().int().positive().default(120),
    LOG_LEVEL: z.string().default('info'),
    MIGRATIONS_DIR: z.string().optional(),
    SERVICE_NAME: z.string().default('scheduling-service'),
    EVENT_BUS_URL: z.string().optional(),
    EVENT_BUS_DRIVER: z.enum(['in-memory', 'rabbitmq', 'nats']).optional(),
    EVENT_BUS_EXCHANGE: z.string().optional(),
    EVENT_BUS_QUEUE_GROUP: z.string().optional(),
    AVAILABILITY_BASE_URL: z.string().url().optional(),
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().optional(),
    TRACING_EXPORT_JSON: z
      .string()
      .optional()
      .transform((value) => {
        if (value === undefined) return undefined;
        return value !== 'false';
      }),
    JWT_SECRET: z.string().min(8, 'JWT_SECRET is required and must be at least 8 characters').default('change-me'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
    METRICS_ENABLED: z
      .string()
      .optional()
      .transform((value) => {
        if (value === undefined) return undefined;
        return value !== 'false';
      })
  })
  .transform((values) => ({
    ...values,
    MIGRATIONS_DIR: values.MIGRATIONS_DIR ?? DEFAULT_MIGRATIONS_DIR,
    METRICS_ENABLED: values.METRICS_ENABLED ?? true,
    DATABASE_MAX_POOL: values.DATABASE_MAX_POOL ?? 10,
    IDEMPOTENCY_TTL_SECONDS: values.IDEMPOTENCY_TTL_SECONDS ?? 86400,
    EVENT_BUS_DRIVER:
      values.EVENT_BUS_DRIVER ??
      (values.EVENT_BUS_URL && values.EVENT_BUS_URL.startsWith('amqp')
        ? 'rabbitmq'
        : 'in-memory'),
    EVENT_BUS_EXCHANGE: values.EVENT_BUS_EXCHANGE ?? 'domain.events',
    EVENT_BUS_QUEUE_GROUP:
      values.EVENT_BUS_QUEUE_GROUP ?? `${values.SERVICE_NAME}.workers`,
    TRACING_EXPORT_JSON: values.TRACING_EXPORT_JSON ?? false,
    JWT_SECRET: values.JWT_SECRET,
    JWT_ACCESS_TTL_SECONDS: values.JWT_ACCESS_TTL_SECONDS,
    JWT_REFRESH_TTL_SECONDS: values.JWT_REFRESH_TTL_SECONDS
  }));

export type AppConfig = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    super('Invalid configuration');
    this.name = 'ConfigError';
  }
}

let cachedConfig: AppConfig | null = null;

function parseEnvironment(
  source: NodeJS.ProcessEnv,
  { exitOnError }: { exitOnError: boolean }
): AppConfig {
  const result = configSchema.safeParse(source);

  if (!result.success) {
    if (exitOnError) {
      // eslint-disable-next-line no-console
      console.error('❌ Invalid configuration', result.error.flatten().fieldErrors);
      process.exit(1);
    }

    throw new ConfigError(result.error.issues);
  }

  return Object.freeze(result.data);
}

export function loadConfig(
  overrides?: Partial<NodeJS.ProcessEnv>
): AppConfig {
  if (overrides) {
    return parseEnvironment(
      {
        ...process.env,
        ...overrides
      },
      { exitOnError: false }
    );
  }

  if (!cachedConfig) {
    cachedConfig = parseEnvironment(process.env, { exitOnError: true });
  }

  return cachedConfig;
}

export const config = loadConfig();

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
    AVAILABILITY_BASE_URL: z.string().url().optional(),
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().optional(),
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
    IDEMPOTENCY_TTL_SECONDS: values.IDEMPOTENCY_TTL_SECONDS ?? 86400
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

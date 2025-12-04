async function main() {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? 'postgresql://localhost:5432/scheduling';
  process.env.PORT = process.env.PORT ?? '3000';
  process.env.RESERVATION_TTL = process.env.RESERVATION_TTL ?? '120';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

  const { logger, runMigrations } = await import('@barbershop/shared');

  logger.info('Starting migrations');
  await runMigrations();
  logger.info('Migrations finished');
}

main().catch(async (error) => {
  const { logger } = await import('@barbershop/shared');
  logger.error({ err: error }, 'Migration runner failed');
  process.exit(1);
});

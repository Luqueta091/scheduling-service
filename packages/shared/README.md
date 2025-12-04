# @barbershop/shared

Pacote compartilhado com utilidades para os serviços da plataforma de agendamentos.

## Conteúdo

- `config/` — loader de variáveis de ambiente com validação via Zod.
- `logger/` — logger estruturado com Pino e helper `withContext`.
- `db/` — wrapper do `pg` com `getDb()`, `withTransaction()` e runner de migrações (stub).
- `eventbus/` — implementação in-memory de EventBus para uso em testes/dev.
- `http/metrics.ts` — middleware e router para expor métricas Prometheus.
- `errors/` — hierarquia básica de erros (`ValidationError`, `ConflictError`, etc.).

## Uso

```ts
import { config, logger, getDb, eventBus, metricsRouter } from '@barbershop/shared';

const appConfig = config;
const log = logger.withContext({ service: 'scheduling' });
const pool = getDb();
```

### Logger com contexto

```ts
const log = logger.withContext({ reservationToken: 'resv_123', userId: 'user_456' });
log.info('Appointment confirmed');
```

### Transações

```ts
await withTransaction(async (client) => {
  await client.query('INSERT ...');
});
```

### Event bus in-memory

```ts
eventBus.subscribe('AppointmentCreated', async (event) => {
  console.log(event.payload);
});

eventBus.publish({ type: 'AppointmentCreated', payload: { appointmentId: '123' } });
```

## Migrações

- Adicione arquivos SQL ou scripts na pasta `packages/shared/migrations`.
- O runner atual é um stub: basta manter a ordem numérica dos arquivos para futura implementação.

## Desenvolvimento

```bash
npm run build:shared
```

Integração com serviços:

1. Adicione `@barbershop/shared` nas dependências (`"file:packages/shared"`).
2. Utilize os exports conforme a necessidade (`config`, `logger`, `db`, `eventbus`, `http/metrics`).
3. Ajuste o `.env` do serviço para conter `NODE_ENV`, `PORT`, `DATABASE_URL`, `RESERVATION_TTL`, `LOG_LEVEL`.

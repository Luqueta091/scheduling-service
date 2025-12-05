# Scheduling Service

Serviço de agendamento autoritativo para uma barbearia, responsável por criar, cancelar e marcar faltas em compromissos, garantindo atomicidade com tokens de reserva e publicação de eventos de domínio.

## Visão Geral

- **Stack:** Node.js + TypeScript, Express, PostgreSQL, Testcontainers, Vitest.
- **Arquitetura:** camadas separadas (interfaces → aplicação → domínio → infraestrutura) com uso de transações e locks pessimistas em reservas.
- **Observabilidade:** logs estruturados (Pino), métricas Prometheus, ganchos básicos para tracing com OpenTelemetry API.
- **Eventos:** publicação em barramento (stub local) para `AppointmentCreated`, `AppointmentCancelled`, `AppointmentNoShow`.

## Pré-requisitos

- Node.js 20+
- Docker & Docker Compose
- pnpm (recomendado) ou npm/yarn

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

### Configurando o EventBus

O serviço usa um barramento de eventos resiliente com fallback in-memory. Para desenvolvimento local simples, mantenha `EVENT_BUS_DRIVER=in-memory` (valor padrão do `.env.example`).

Para utilizar RabbitMQ:

1. Suba uma instância RabbitMQ (ex.: `docker run -p 5672:5672 rabbitmq:3-management`).
2. Ajuste as variáveis no `.env`:

```
EVENT_BUS_DRIVER=rabbitmq
EVENT_BUS_URL=amqp://guest:guest@localhost:5672
EVENT_BUS_EXCHANGE=domain.events
EVENT_BUS_QUEUE_GROUP=scheduling-service.workers
```

3. Reinicie o serviço. Em caso de indisponibilidade do broker, o adaptador tenta reconectar automaticamente e registra warnings no logger.

#### Testando publicações de evento

1. Execute `npm run test:ci` para validar os testes E2E que cobrem `AppointmentCreated`, `AppointmentCancelled` e `AppointmentNoShow`.
2. Para validar manualmente, abra um consumer (por exemplo, `rabbitmqadmin get queue=<queue>`), crie um agendamento via HTTP e acompanhe o evento publicado.

### Cliente de Slot / Availability

Defina `AVAILABILITY_BASE_URL` para ativar o cliente HTTP resiliente. O adaptador aplica retries exponenciais, breaker e cache TTL baseado no `RESERVATION_TTL`. Em ambientes locais sem o serviço de slots, o stub in-memory permanece disponível e loga um aviso para cada validação realizada. A métrica `slot_service_health` (gauge) reflete o estado atual do breaker: `status="ok"|"degraded"|"down"`.

### Observabilidade & Tracing

- Cada requisição HTTP é envolvida por um span raiz (`HTTP <método> <rota>`); controladores e serviços criam spans filhos para DB, Slot Client e EventBus.
- Os headers `x-trace-id`, `x-span-parent` (span id atual) e `x-response-time` são devolvidos em todas as respostas. Para encadear com chamadas do frontend, envie `x-trace-id`/`x-span-parent` nas requisições subsequentes.
- Ative `TRACING_EXPORT_JSON=true` para que cada span seja exportado em JSON nos logs (`trace.span`).
- Exemplo de chamada instrumentada:

```bash
curl -X POST http://localhost:3000/agendamentos \
  -H "x-trace-id: web-trace-123" \
  -H "x-span-parent: web-span-abc" \
  -H "Content-Type: application/json" \
  -d '{ "clientId": "...", ... }'
```

### Métricas Prometheus

- `/metrics` expõe, além das métricas HTTP padrão, os contadores `appointments_created_total`, `appointments_cancelled_total`, `appointments_no_show_total`, `appointments_conflicts_total`, o histogram `appointment_creation_duration_seconds_bucket` e o gauge `slot_service_health`.
- Para coletar com Prometheus local:

```yaml
scrape_configs:
  - job_name: 'scheduling-service'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3000']
        labels:
          service: scheduling
```

- Valide rapidamente:

```bash
curl -s http://localhost:3000/metrics | grep appointment_creation_duration_seconds
```

## Banco de Dados

O serviço utiliza PostgreSQL. Um stub está disponível no `docker-compose.yml` para desenvolvimento. Execute as migrações com:

```bash
npm run migrate
```

Para testes, o pacote `@testcontainers/postgresql` sobe containers efêmeros automaticamente.

## Execução com Docker

```bash
docker compose up --build
```

## Scripts úteis

- `npm run dev` — inicia o servidor com reload (ts-node-dev).
- `npm run build` — transpila para `dist/`.
- `npm run start` — executa build em produção.
- `npm run lint` — checa lint (eslint + prettier).
- `npm run test` — executa testes unitários e de integração.
- `npm run migrate` — executa (stub) das migrações.
- `npm run clean` — remove artefatos de build.

## Endpoints (cURL examples)

### Criar agendamento

```bash
curl -X POST http://localhost:3000/agendamentos \
  -H "Content-Type: application/json" \
  -H "x-reservation-token: resv_tok_demo" \
  -d '{
    "clientId": "ef8730bd-8dbe-45b6-b5b4-2cb4c2ff01d8",
    "unitId": "a3d932ae-f23c-4ce5-9ed3-2f2eca4a0df8",
    "serviceId": "5b6ad154-42d8-4a73-8c23-5ce77e9d0b74",
    "barberId": "e5a7b492-991a-4e54-892d-8c4191dcf689",
    "start": "2025-12-03T15:00:00Z",
    "reservationToken": "resv_tok_abcdef123456",
    "origin": "cliente",
    "notes": "Primeira visita"
  }'
```

### Buscar agendamento por ID

```bash
curl http://localhost:3000/agendamentos/{id} \
  -H "x-reservation-token: resv_tok_demo"
```

### Listar agendamentos

```bash
curl "http://localhost:3000/agendamentos?clienteId={clienteId}&date=2025-12-03" \
  -H "x-reservation-token: resv_tok_demo"
```

### Cancelar agendamento

```bash
curl -X PUT http://localhost:3000/agendamentos/{id}/cancel \
  -H "Content-Type: application/json" \
  -H "x-reservation-token: resv_tok_demo" \
  -d '{
    "reason": "Cliente solicitou cancelamento"
  }'
```

### Marcar falta

```bash
curl -X PUT http://localhost:3000/agendamentos/{id}/falta \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token_barber>" \
  -H "x-reservation-token: resv_tok_demo" \
  -d '{
    "timestamp": "2025-12-03T15:45:00Z"
  }'
```

## Autenticação de barbeiros e admins

- `POST /auth/login` — body `{ "email": "barber@example.com", "password": "senha" }`. Retorna `{ accessToken, refreshToken, user }`.
- `POST /auth/refresh` — body `{ "refreshToken": "..." }`.
- Endpoints protegidos utilizam `Authorization: Bearer <accessToken>` e podem exigir `requireRole('barbeiro')` ou `requireRole('admin')`. Exemplo:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "barber@example.com", "password": "senha" }'
```

## Estrutura

```
src/
  app.ts
  server.ts
  config/
  interfaces/http/
  application/
  domain/
  infrastructure/
  shared/
```

## Próximos passos

- Expandir publisher de eventos para broker real (RabbitMQ/Kafka).
- Adicionar política de cancelamento configurável por unidade.
- Implementar auto-no-show opcional (cron ou consumer).

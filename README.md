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
  -H "x-reservation-token: resv_tok_demo" \
  -d '{
    "markedBy": "barbeiro",
    "timestamp": "2025-12-03T15:45:00Z"
  }'
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

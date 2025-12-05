# Backlog — Scheduling Service Roadmap

> Documento auxiliar enquanto as issues reais não são criadas no GitHub.

## Availability + Slot Locking ✅
- **Status:** Entregue. Módulo dedicado criado (`src/modules/availability`) com generation/listagem de slots, lock/release transactional e métricas `locks.*`.
- **Endpoints:** `GET /units/:unitId/availability`, `POST /slots/lock`, `POST /slots/release`.
- **Próximo:** integrar criação de agendamento para consumir o módulo (lock → appointment → release automático).

## Eventos de Slot ✅
- `slot.locked` e `slot.released` publicados via EventBus (RabbitMQ ou fallback in-memory).
- Payload inclui `reservationToken`, `unitId`, `serviceId`, `date`, `startTime`, `endTime`, `capacityTotal`, `capacityUsed` + `reason` em releases.
- **Próximo:** criar consumers (Scheduling/Notifications) e garantir idempotência.

## Integração com broker real (RabbitMQ) 🟡
- Adapter RabbitMQ implementado (`RabbitMqEventBus`), configs no `.env.example` e `docker-compose`.
- **Pendências:** pipeline CI needs RabbitMQ service + health checks, smoke tests com broker real, release job publicando imagem.
- **Novos itens:** dead-letter e políticas de retry no RabbitMQ para eventos críticos.

## Worker de Notifications (Backlog)
- Consumir `appointment.*` + `slot.*`.
- Enviar notificações fake/log com idempotência.
- Avaliar mover para serviço separado.

## Autenticação de clientes (OTP) (Backlog)
- Endpoints `/auth/login-client/request` e `/auth/login-client/verify`.
- Persistência de OTPs, TTL e emissão de token cliente.

## Métricas e tracing de locking ✅
- Contadores `locks.attempts/success/conflicts/expired` expostos em `/metrics`.
- Spans `AvailabilityService.*` carregam `reservationToken`.
- **Próximo:** dashboard Prometheus + alerts para taxa de conflitos e latência.

## Documentação e deploy 🟡
- README atualizado com EventBus, Availability e novas rotas.
- **Pendências:** ADRs (RabbitMQ, estratégia de locking), runbook completo, exemplos `docker-compose` com RabbitMQ + Notifications.

## Novos itens adicionados ao roadmap
- Consumers/Workers para Notification Service ouvindo `slot.*`/`appointment.*`.
- Dead-letter queue + retry policy para o broker real.
- Dashboard/ métricas específicas de eventos (taxa de publicação, falhas, lag por consumer).

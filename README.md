# EV Rental IoT Gateway

Standalone Node.js + Express (TypeScript) service that ingests vehicle telemetry over MQTT, caches the latest GPS/battery position in Redis, persists telemetry history to PostgreSQL, and raises alerts (low battery, vehicle offline).

This service is **separate from the Next.js Web Backoffice repo**. The backoffice only reads from Redis/PostgreSQL — it never talks to MQTT directly.

## Architecture

```
Vehicle (IoT device)
  │ MQTT  topic: vehicle/{vehicleId}/data
  ▼
mqtt/client.ts ──► mqtt/handler.ts
                      ├─ validators/telemetry.ts   (zod schema + clock-drift check)
                      ├─ services/vehicle-validator.ts (vehicle exists? 5 min cache)
                      ├─ services/redis-writer.ts   ──► Redis  vehicle:pos:{id}  (TTL 300s)
                      ├─ services/telemetry-writer.ts ──► PostgreSQL telemetry_history (batched)
                      ├─ services/alert-service.ts  ──► PostgreSQL alerts (battery_low, resolve vehicle_offline)
                      └─ services/vehicle-sync.ts   ──► PostgreSQL vehicles (soc/odometer/status)

services/offline-detector.ts — cron (every minute), scans Redis for vehicles with
no recent position and marks them offline + raises a vehicle_offline alert.

api/health.ts  — GET /health  (checks MQTT, Redis, DB)
api/status.ts  — GET /status  (online vehicle count, messages/min)
```

## Prerequisites

- Node.js + pnpm
- A running MQTT broker (Mosquitto)
- Redis
- PostgreSQL with the `vehicles`, `alerts`, and `telemetry_history` tables (created by the main backoffice repo's migrations)

## Setup

```bash
cd ev-rental-iot-gateway
pnpm install
cp .env.example .env   # then edit values for your environment
```

### Environment variables (`.env`)

| Variable | Description | Default |
|---|---|---|
| `MQTT_URL` | Mosquitto broker URL | `mqtt://localhost:1883` |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | Broker credentials | — |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `OFFLINE_TIMEOUT_SECONDS` | (reserved) offline threshold | `300` |
| `TELEMETRY_BATCH_SIZE` | Rows buffered before a forced insert | `10` |
| `TELEMETRY_BATCH_INTERVAL_MS` | Max time between batch inserts | `2000` |
| `PORT` | HTTP port for `/health` and `/status` | `3001` |

## Running

```bash
pnpm dev      # nodemon + ts-node, watches src/
pnpm build    # tsc -> dist/
pnpm start    # node dist/index.js (run after build)
```

On startup the gateway connects to MQTT (auto-reconnects with exponential backoff up to 60s), starts the offline-detector cron, and serves HTTP on `PORT`.

Shutdown is graceful on `SIGTERM`/`SIGINT`: stops accepting HTTP requests, stops the cron, disconnects MQTT, flushes any buffered telemetry to PostgreSQL, then closes Redis and the DB pool.

## MQTT contract

- **Topic**: `vehicle/{vehicleId}/data`
- **Payload** (JSON):

```json
{
  "vehicle_id": "uuid",
  "lat": 13.7563,
  "lng": 100.5018,
  "speed": 42.5,
  "heading": 180,
  "soc": 67,
  "temperature": 32.1,
  "odometer": 15230,
  "charge_cycles": 112,
  "status": "available | rented | charging | under_repair",
  "timestamp": "2026-06-24T10:00:00.000Z"
}
```

Validation rules (see `src/validators/telemetry.ts`):
- `lat` in [-90, 90], `lng` in [-180, 180], `speed` in [0, 200], `heading` in [0, 360], `soc` in [0, 100], `temperature` in [-20, 80], `odometer`/`charge_cycles` non-negative.
- `timestamp` must be an ISO datetime within 60 seconds of server time (rejects stale/clock-drifted messages).
- Messages for a `vehicle_id` not present in the `vehicles` table are dropped (with a 5-minute existence cache to avoid hammering PostgreSQL).
- Malformed JSON or schema failures are logged and dropped — the gateway does not retry or NACK individual MQTT messages.

## What happens on a valid message

1. Latest position written to Redis key `vehicle:pos:{vehicle_id}` (TTL 300s) — this is what the backoffice map reads.
2. Any open `vehicle_offline` alert for that vehicle is resolved (receiving telemetry proves it's back online).
3. The reading is buffered and batch-inserted into `telemetry_history` (flushed every `TELEMETRY_BATCH_SIZE` rows or `TELEMETRY_BATCH_INTERVAL_MS`, whichever comes first).
4. If `soc < 20`, a `battery_low` alert is created (`critical` below 15%, otherwise `warning`) — deduplicated so only one open alert per vehicle/type exists at a time.
5. The `vehicles` row is updated with the latest `soc_percent`, `odometer` (monotonically increasing via `GREATEST`), and `status`.

## Offline detection

Every minute, a cron job (`src/services/offline-detector.ts`) scans Redis for vehicles with a live `vehicle:pos:*` key. Any vehicle in the `vehicles` table that isn't `offline`/`under_repair` and has no live key is marked `offline` and gets a `critical` `vehicle_offline` alert (deduplicated the same way). `under_repair` vehicles are intentionally excluded since they have no telemetry while in the workshop.

## HTTP endpoints

- `GET /health` — `200 { status: "ok", mqtt, redis, db }` or `503 { status: "degraded", ... }` if any dependency is down.
- `GET /status` — `200 { vehiclesOnline, messagesPerMinute }`.

## Testing

### Unit tests (Vitest)

```bash
pnpm test          # run once
pnpm test:watch    # watch mode
```

Every file under `src/services/` and `src/validators/` has a matching `*.test.ts` — these are the priority targets since DB/Redis/MQTT clients are all injectable, so the core logic (threshold math, batching, dedupe, reconnect backoff, message routing order) is fully mockable. See `ev-rental-go-backoffice/planings/TESTING_PLAN.md` §2.2 for the full module-by-module rationale, including the production bug (`soc: 78.5` inserted into an `integer` column) that motivated several of these.

### E2E full-chain tests (`@gateway`, driven from the backoffice repo)

This repo has no Playwright suite of its own — instead, the backoffice repo's `pnpm test:e2e:gateway` suite starts this process (via `dev:test`, see below) and drives it with real MQTT messages to verify the whole chain (MQTT → validate → Redis/Postgres → backoffice UI). Run from `ev-rental-go-backoffice/`:

```bash
pnpm test:e2e:gateway
```

For this to work, this repo needs:

- **`.env.test`** — same shape as `.env.example`, but pointed at the backoffice's isolated test resources instead of dev ones:
  - `DATABASE_URL` → the `ev_rental_go_test` database (same Postgres container, different DB name)
  - `REDIS_URL` → Redis logical db `1` (e.g. `redis://localhost:6379/1`) instead of the default `0`
  - `MQTT_URL`/credentials can stay the same — Mosquitto isn't test/dev-isolated, it's just transport
- **`dev:test` script** (already in `package.json`): `ts-node src/index.ts dotenv_config_path=.env.test` — loads `.env.test` instead of `.env`, and should run on a different `PORT` than your local dev gateway (e.g. `3101` vs `3001`) so both can coexist
- Two vehicle MQTT credentials provisioned in the backoffice repo's `mosquitto/passwd`, matching fixed vehicle UUIDs the E2E fixtures seed into `ev_rental_go_test` — see `ev-rental-go-backoffice/planings/TESTING_PLAN.md` §6 progress log for how these were set up

Playwright manages this process's lifecycle automatically (starts it, waits on `GET /health`, tears it down after) — you don't need to run `dev:test` manually unless debugging.

## Logs

All logs are single-line JSON (`{ level, ts, event, ...fields }`) to stdout — suitable for direct ingestion by a log collector. Local dev runs (e.g. under pm2) write to `gateway.log` / `gateway_out.log` / `gateway_err.log`.

# @crm-tableturnerr/telemetry-client

Dependency-free telemetry client for Node/TS services. It pushes structured
logs and periodic heartbeats to a central ingest API using the global `fetch`
(Node 18+). No runtime dependencies.

It is built to never crash or block its host: every method swallows its own
errors, and when telemetry is not configured the client silently becomes a
no-op so the service keeps running.

## Security

`TELEMETRY_TOKEN` is a **server-side secret**. Only run this client where env
secrets are safe (backend services, workers, agents). **Never** bundle it into
a browser or any client shipped to end users — doing so leaks the token.

## Install

It is a workspace package. Reference it from another package in the monorepo:

```json
{
  "dependencies": {
    "@crm-tableturnerr/telemetry-client": "workspace:*"
  }
}
```

## Environment variables

| Variable          | Required | Description                                                  |
| ----------------- | -------- | ------------------------------------------------------------ |
| `TELEMETRY_URL`   | yes      | Base URL of the ingest API, e.g. `https://ingest.example.com`. |
| `TELEMETRY_TOKEN` | yes      | Bearer token (server-side secret). Sent as `Authorization: Bearer <token>`. |
| `SERVICE_KEY`     | yes      | Stable identifier for the calling service (passed in code).   |

If `TELEMETRY_URL` or `TELEMETRY_TOKEN` is missing, the client logs a single
warning and runs as a no-op.

## Usage

```ts
import { telemetryFromEnv } from '@crm-tableturnerr/telemetry-client';

const telemetry = telemetryFromEnv(process.env, process.env.SERVICE_KEY ?? 'my-service');

// Background flushing + heartbeats (timers are unref'd, so they won't keep the
// process alive on their own).
telemetry.startAutoFlush();
telemetry.startHeartbeat(30_000, { version: '1.2.3', status: 'ok' });

telemetry.info('service started', { event: 'startup', context: { pid: process.pid } });
telemetry.warn('slow upstream', { context: { latencyMs: 1200 } });
telemetry.error('request failed', { event: 'http_error', context: { status: 502 } });

// On shutdown: stop timers and flush whatever is queued.
await telemetry.close();
```

### Explicit construction

```ts
import { createTelemetry } from '@crm-tableturnerr/telemetry-client';

const telemetry = createTelemetry({
  url: process.env.TELEMETRY_URL!,
  token: process.env.TELEMETRY_TOKEN!,
  serviceKey: 'zoomphone-bridge',
  flushIntervalMs: 15_000, // default
  maxBatch: 50,            // default, capped at 100
  defaultContext: { region: 'us-east' }, // merged into every entry
  onError: (e) => console.error('telemetry failed', e),
});
```

## API

- `new TelemetryClient(opts)` / `createTelemetry(opts)` — construct a client.
- `telemetryFromEnv(env, serviceKey)` — construct from `TELEMETRY_URL` / `TELEMETRY_TOKEN`.
- `log(level, message, opts?)` and `debug/info/warn/error/fatal(message, opts?)` — queue an entry.
- `flush()` — POST queued entries now; the queue is cleared on attempt and dropped on failure.
- `startAutoFlush()` / `stopAutoFlush()` — periodic flush (default every 15s).
- `heartbeat(opts?)` — send a single heartbeat.
- `startHeartbeat(intervalMs, opts?)` / `stopHeartbeat()` — periodic heartbeat; sends one immediately.
- `close()` — stop timers and do a final flush.
- `enabled` — `false` when the client is a no-op.

`opts` for logs is `{ event?: string; context?: Record<string, unknown> }`.
`opts` for heartbeats is `{ version?: string; status?: 'ok' | 'degraded' | 'down'; meta?: Record<string, unknown> }`.

## Ingest contract

**Logs** — `POST {url}/api/telemetry/logs`

```
Authorization: Bearer <token>
Content-Type: application/json

{
  "service_key": "my-service",
  "entries": [
    { "level": "info", "message": "...", "event": "startup", "context": { }, "ts": "2026-01-01T00:00:00.000Z" }
  ]
}
```

`entries` is capped at 100 per request (batches default to 50). Responses
`200` / `207` / `400` / `401` / `429`; a `207` (partial) or any non-2xx is
reported via `onError` and the batch is dropped.

**Heartbeat** — `POST {url}/api/telemetry/heartbeat`

```
Authorization: Bearer <token>
Content-Type: application/json

{ "service_key": "my-service", "version": "1.2.3", "status": "ok", "meta": { } }
```

## Build

```bash
pnpm --filter @crm-tableturnerr/telemetry-client build
```

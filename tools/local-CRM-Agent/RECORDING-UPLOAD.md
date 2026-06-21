# CRM Agent — call recording → GoHighLevel

The agent records each Zoom Phone call locally (one clip per call) and attaches
it to the matching **GoHighLevel** contact. GHL is the CRM; recordings no longer
go to PocketBase.

## Flow

```
call detected ─► record (WASAPI loopback + mic, mono)
              ─► WAV ─► MP3 (LameMP3FileWriter; WAV kept as fallback)
              ─► on conversion complete, queued for upload
              ─► POST {workerBaseUrl}/recordings/ingest   (multipart, Bearer agent token)
              ─► worker upserts the GHL contact by phone, logs the call,
                 and attaches the audio (Conversations ≤5 MB, else Medias API)
```

The worker (`zoomphone-bridge`, at `tools/zoomphone-ghl-bridge`) owns all GHL
credentials and logic. The agent holds only the worker URL + a shared agent
token, never GHL secrets.

### Two call surfaces

| Surface | How recording is triggered | `channel` |
|---------|---------------------------|-----------|
| Zoom **desktop** | Local audio/window fusion auto-records | `desktop` |
| Zoom **web** | Chrome extension → Native Messaging → agent (see [NATIVE-MESSAGING.md](NATIVE-MESSAGING.md)) | `web` |

## Upload contract (agent → worker)

`POST {workerBaseUrl}/recordings/ingest` — `multipart/form-data`,
`Authorization: Bearer <agent token>`:

| Field | Source |
|-------|--------|
| `clip` (file) | the MP3 (or WAV fallback); content-type set accordingly |
| `callId` | minted `{channel}:{repUserId}:{connectTsMs}` (deterministic, so retries dedup) |
| `repUserId` | configured rep id (ideally the rep's Zoom user_id) |
| `channel` | `desktop` / `web` |
| `phoneE164` | the dialed number (omitted if unknown → worker parks for review) |
| `connectTsMs` / `endTsMs` | recording start (UTC epoch ms) and start + duration |

Responses: `200 { ghlMessageId }` attached · `202 { status:"review" }` no phone,
parked in GHL Medias for manual review · `409` already ingested (dedup) · `401`
token rejected (agent surfaces `auth_required`) · other `4xx` permanent · `5xx`/
network retried with backoff + a global circuit breaker.

## Eligibility

A recording uploads as soon as WAV→MP3 conversion finishes — there is no
CRM-link step (the worker matches the contact by phone). Every detected call is
recorded and uploaded; calls with no resolvable number land in the worker's
review path rather than being dropped.

## Provisioning (no hardcoded secrets)

The agent needs three values. Resolved at startup as **persisted config first,
then environment variable**:

| Value | Config (`%AppData%\CrmAgent\agent-config.json`) | Env var | WS command |
|-------|----------------------------------|---------|------------|
| Worker base URL | `workerBaseUrl` | `CRM_AGENT_WORKER_URL` | `setWorkerConfig` |
| Shared agent token | `agentTokenProtected` (DPAPI) | `CRM_AGENT_TOKEN` | `setWorkerConfig` |
| Rep id | `repUserId` | `CRM_AGENT_REP_USER_ID` | `setWorkerConfig` |

The token is the worker's `AGENT_SHARED_TOKEN` (one shared value for all agents).
It is DPAPI-encrypted to the current Windows user on disk. Env-provisioned values
are persisted on first run so later launches don't depend on the environment.

To provision at runtime, send over the localhost WebSocket:

```json
{ "type": "setWorkerConfig",
  "workerBaseUrl": "https://<worker-host>",
  "agentToken": "<AGENT_SHARED_TOKEN>",
  "repUserId": "<rep zoom user_id>" }
```

## Known follow-ups (worker side)

- **Duplicate call logs:** the worker also logs calls from Zoom webhooks, and
  `/recordings/ingest` logs a call when it attaches audio. Until the ingest
  dedups against the webhook-logged call (by rep + time window), GHL can show two
  call entries for one call.
- **Web callId reconciliation:** the agent mints the `callId`; correlating it to
  the real Zoom `call_id` (plan §4) is not yet implemented in the worker ingest.

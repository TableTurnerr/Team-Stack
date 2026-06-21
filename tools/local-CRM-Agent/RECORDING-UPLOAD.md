# CRM Agent — call recording → GoHighLevel

The agent records each Zoom Phone call locally (one clip per call) and attaches
it to the matching **GoHighLevel** contact. GHL is the CRM; recordings no longer
go to PocketBase.

## Flow

```
call detected ─► record (WASAPI loopback + mic, mono)
              ─► WAV ─► MP3 (LameMP3FileWriter; WAV kept as fallback)
              ─► on conversion complete, resolve the real Zoom call_id + number
                 from Zoom call_history by matching THIS machine's device IP +
                 the recording start time (ZoomPhoneApiService.ResolveOwnCallAsync)
              ─► POST {workerBaseUrl}/recordings/ingest   (multipart, Bearer agent token)
              ─► worker correlates the clip to the webhook-logged call by exact
                 call_id (else phone + time), and attaches the audio
                 (Conversations ≤5 MB, else Medias API)
```

The worker (`zoomphone-bridge`, at `tools/zoomphone-ghl-bridge`) owns all GHL
credentials and logic. The agent holds only the worker URL + a shared agent
token, never GHL secrets.

### Getting the number on a shared Zoom account (device-IP match)

The whole team shares one Zoom account on different machines, and a desktop-dialed
call's number isn't reliably exposed in Zoom's UI. So the agent reads it from
Zoom's own **`call_history`** API: every record carries `device_private_ip` (the
LAN IP of the machine that placed the call). The agent matches the record whose
`device_private_ip` is one of **this machine's** local IPs and whose `start_time`
is near the recording start — an exact per-device match, since a machine is only
on one call at a time. From that record it takes the real `call_id` and the
external `*_did_number`. The worker then correlates by exact `call_id`. This needs
the agent's `zoom-api.json` (S2S creds + the shared `zoomUserId`/email) configured.

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
| `callId` | minted `{channel}:{repUserId}:{connectTsMs}` — **client dedup key only** (the worker keys `clip:{callId}`); not a Zoom id |
| `zoomCallId` | the **real Zoom call_id**, resolved from `call_history` by device-IP match; enables exact correlation (omitted if unresolved → worker falls back to phone+time) |
| `repUserId` | device-provisioned rep id (maps to a GHL userId on the worker) |
| `channel` | `desktop` / `web` |
| `phoneE164` | the external number, preferably the `call_history`-resolved `*_did_number` (omitted if unknown) |
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

## Correlation (worker side)

The worker correlates each uploaded clip to the call it already logged from the
Zoom webhook, and attaches the audio to **that** conversation (no second
standalone entry):

1. **Exact `call_id`** — when the agent resolved `zoomCallId`, the worker attaches
   straight to `call:{zoomCallId}`.
2. **Phone + connect-time** — fallback when `zoomCallId` is absent.
3. **Pending** — if the call isn't logged yet (the clip beat the webhook), the
   clip is held and attached when the call-log webhook lands.
4. **Review** — only when there's neither a number nor a `call_id`, the clip is
   parked in GHL Medias for manual review (never dropped).

Uploads dedupe on `callId` (`clip:{callId}`); a repeat returns `409`.

### Remaining caveats

- `call_history` can lag a few seconds after hangup; the agent retries the resolve
  a few times before uploading.
- A rep on a VPN matches on the VPN-assigned IP (still per-machine).

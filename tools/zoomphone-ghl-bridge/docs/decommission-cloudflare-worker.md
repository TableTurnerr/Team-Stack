# Decommissioning the old Cloudflare Worker

The Zoom Phone to GoHighLevel bridge has moved off Cloudflare Workers to a
self-hosted Node service (`~/apps/zoomphone-bridge` on the `home` box, behind the
existing Cloudflare Tunnel at `https://zoomphone.tableturnerr.com`). Once the
self-hosted bridge is validated in production, the old Worker, its KV namespace,
and its Durable Object can be retired.

**Do not run any of this until the self-hosted bridge has handled real traffic
cleanly** (a live Zoom call logged to GHL with its recording attached, GHL OAuth
re-installed against the new host). Decommissioning is irreversible for the KV
data; the rollback note at the bottom is your safety net.

The old Worker resources, for reference:

| Resource | Identifier (from `wrangler.toml`) |
|---|---|
| Worker | `zoomphone-bridge` |
| KV namespace | binding `STATE`, id `e734b5fc930d46d191406cd39dc6ce39` (preview `21decfcd2acc4af081d60ef2284f358e`) |
| Durable Object | binding `AGENT_HUB`, class `AgentHub` (migration tag `v1`) |

> The `AgentHub` Durable Object and the WebSocket push path were already removed
> from the source (the shared Zoom account makes a live worker→agent push
> impossible). The DO still exists on Cloudflare only because a previously
> deployed Worker version declared it; deleting the Worker removes it.

---

## 0. Pre-flight: confirm the new host is carrying traffic

Before touching Cloudflare, verify the self-hosted bridge is the live path:

1. The Zoom **Event notification endpoint URL** points at
   `https://zoomphone.tableturnerr.com/zoom/webhook` (not `*.workers.dev`).
2. The GHL Marketplace **Redirect URL** points at
   `https://zoomphone.tableturnerr.com/oauth/callback`, and `/oauth/install` has
   been re-run against the new host (tokens were not migrated — they're re-issued).
3. The new service answers: `curl -fsS https://zoomphone.tableturnerr.com/health`
   returns `ok`.
4. A real test call logs to GHL with its recording attached, through the new host.
5. The old Worker is receiving **no** new requests. Check in the Cloudflare
   dashboard (Workers & Pages → `zoomphone-bridge` → Metrics) or:
   ```sh
   npx wrangler tail zoomphone-bridge
   ```
   Place a test call and confirm nothing arrives at the Worker. Leave the Worker
   live but idle for a few days as a fallback before deleting.

---

## 1. Remove the Worker routes / triggers

The Worker is reached either at its `*.workers.dev` URL or via a custom route.
Nothing should still point at it after step 0, but make it unreachable explicitly:

- **Custom domain / route** (if one was configured): Cloudflare dashboard →
  Workers & Pages → `zoomphone-bridge` → Settings → Domains & Routes → remove
  each route. Or via API/wrangler if routes live in a config.
- **`workers.dev` subdomain**: dashboard → the Worker → Settings → Domains &
  Routes → disable the `workers.dev` route so the `*.workers.dev` URL stops
  serving.

At this point the Worker exists but answers nothing.

---

## 2. Delete the Worker

After a quiet observation period with zero traffic:

```sh
npx wrangler delete --name zoomphone-bridge
```

Deleting the Worker also drops its Durable Object class binding (`AgentHub`).
There is no separate "delete Durable Object" step for a code-defined DO — it goes
away with the Worker version that declared it. Confirm afterwards:

```sh
npx wrangler deployments list --name zoomphone-bridge   # should error: not found
```

---

## 3. Delete the KV namespace

The KV held only ephemeral bridge state (GHL OAuth tokens, `call:{id}`,
`recent:{phone}`, `clip:{id}`, `review:{id}`). All of it is now in the
self-hosted SQLite DB, and the GHL tokens were re-issued on the new host, so the
KV data is safe to discard.

List namespaces to confirm the id, then delete both the production and preview
namespaces:

```sh
npx wrangler kv namespace list
npx wrangler kv namespace delete --namespace-id e734b5fc930d46d191406cd39dc6ce39
npx wrangler kv namespace delete --namespace-id 21decfcd2acc4af081d60ef2284f358e
```

> If you want a backup first (optional, recommended):
> ```sh
> npx wrangler kv key list   --namespace-id e734b5fc930d46d191406cd39dc6ce39 > kv-backup-keys.json
> # then bulk-get if needed; most entries are short-TTL and not worth keeping.
> ```

---

## 4. Remove Worker-specific files from the repo

Once the Worker is gone, drop the Cloudflare-only artifacts so the directory is
purely the self-hosted service:

- `tools/zoomphone-ghl-bridge/wrangler.toml`
- `tools/zoomphone-ghl-bridge/.dev.vars.example` (Wrangler's secret-injection
  file; the Node service uses `.env` / `.env.example` instead)
- Any remaining `wrangler` entry in `package.json` `devDependencies`/scripts, and
  the `.wrangler/` line in `.gitignore` once it's no longer needed.
- Update `README.md`: the deploy section should describe the systemd Node service
  + Cloudflare Tunnel (see `docs/git-based-deploy.md`), not `wrangler deploy`.

Commit these as a single "retire Cloudflare Worker" change.

---

## 5. Cloudflare account hygiene (optional)

- Remove the Worker from any account-level **Tail Workers** / log push config.
- If a dedicated Cloudflare API token was minted only for deploying this Worker,
  roll/delete it.
- The Cloudflare **Tunnel** stays — it now fronts the self-hosted bridge (and
  PocketBase). Do **not** delete the tunnel; only ensure its ingress rule for
  `zoomphone.tableturnerr.com` targets `http://localhost:8787` (the Node service),
  not the Worker.

---

## Rollback

If the self-hosted bridge fails after you've started decommissioning:

- **Before step 2 (Worker still exists):** re-enable the Worker's route /
  `workers.dev` subdomain (step 1, reversed) and re-point the Zoom + GHL URLs back
  at the `*.workers.dev` host. Re-run the GHL `/oauth/install` against the Worker
  URL (tokens differ per host). This is a full rollback.
- **After step 2/3 (Worker and KV deleted):** there is no in-place rollback. Redeploy
  from source: `git checkout` the commit that still had `wrangler.toml`, recreate
  the KV namespace (`wrangler kv namespace create STATE`), paste the new id into
  `wrangler.toml`, set secrets with `wrangler secret put`, `wrangler deploy`, then
  re-point Zoom + GHL and re-install OAuth. Because the bridge keeps no
  irreplaceable state (calls come from Zoom webhooks; tokens are re-issuable), a
  fresh Worker is functionally equivalent — only the short-lived correlation
  windows for in-flight calls are lost.

Keep this file until the Worker, KV, and DO are confirmed deleted, then it can be
removed alongside `wrangler.toml`.

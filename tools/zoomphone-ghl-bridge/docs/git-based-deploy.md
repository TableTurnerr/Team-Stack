# Git-based deploy

The self-hosted bridge runs on the `home` box as a **user** systemd service:

| | |
|---|---|
| App directory | `~/apps/zoomphone-bridge` |
| Service | `zoomphone-bridge.service` (user unit, `systemctl --user`) |
| Bind | `127.0.0.1:8787` (fronted by the Cloudflare Tunnel → `https://zoomphone.tableturnerr.com`) |
| Secrets | `~/apps/zoomphone-bridge/.env` (never in git, never in the deploy script) |
| Runtime | Node 24 + `tsx` (no build step; `tsx src/server.ts` runs the TypeScript directly) |

There is **no passwordless sudo** on this box, so everything is done as the
service user. The user systemd instance is controlled with `systemctl --user`,
which needs `XDG_RUNTIME_DIR` set when you're on a non-login shell (e.g. over a
bare SSH command):

```sh
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user restart zoomphone-bridge
```

This replaces the old `tar | ssh` push. Instead of shipping a tarball, the box
pulls the repo and runs from a checkout, so deploys are a `git pull` + restart.

---

## One-time setup on the box

Assuming the repo is checked out somewhere on the box and the app dir is a
checkout (or a worktree/symlink) of `tools/zoomphone-ghl-bridge`:

1. Clone the monorepo (or just keep a checkout that contains this tool):
   ```sh
   git clone https://github.com/TableTurnerr/Team-Stack.git ~/src/Team-Stack
   ln -s ~/src/Team-Stack/tools/zoomphone-ghl-bridge ~/apps/zoomphone-bridge
   ```
   (Or check out directly into `~/apps/zoomphone-bridge`; the deploy script works
   with either, since it `cd`s into the directory and runs `git` there.)

2. Create `~/apps/zoomphone-bridge/.env` from `.env.example` and fill in the real
   secrets. This file is gitignored and stays on the box only.

3. Install the user systemd unit (`~/.config/systemd/user/zoomphone-bridge.service`):
   ```ini
   [Unit]
   Description=Zoom Phone -> GoHighLevel bridge
   After=network-online.target

   [Service]
   Type=simple
   WorkingDirectory=%h/apps/zoomphone-bridge
   ExecStart=/usr/bin/env npm start
   Restart=on-failure
   RestartSec=3
   Environment=NODE_OPTIONS=--disable-warning=ExperimentalWarning

   [Install]
   WantedBy=default.target
   ```
   Then:
   ```sh
   export XDG_RUNTIME_DIR=/run/user/$(id -u)
   systemctl --user daemon-reload
   systemctl --user enable --now zoomphone-bridge
   loginctl enable-linger "$USER"   # keeps the user service running after logout
   ```

4. Confirm: `curl -fsS http://127.0.0.1:8787/health` → `ok`.

---

## Deploying a new version

From your workstation, push to the branch the box tracks, then run the deploy
script **on the box**:

```sh
ssh home '~/apps/zoomphone-bridge/scripts/deploy.sh'
```

Or pin to an exact ref (tag/commit/branch):

```sh
ssh home 'DEPLOY_REF=origin/main ~/apps/zoomphone-bridge/scripts/deploy.sh'
```

The script (`scripts/deploy.sh`) does, in order:

1. `git fetch` and hard-reset the working tree to `DEPLOY_REF` (default
   `origin/main`) — a clean, reproducible checkout, no local drift.
2. `npm install` (installs `tsx` + `@hono/node-server`; no compile step).
3. Restart `zoomphone-bridge.service` via `systemctl --user`.
4. Poll `http://127.0.0.1:8787/health` until it returns `ok` (or fail the deploy).

It never touches `.env` and prints no secrets.

---

## Rollback

Re-run the script pinned at the previous good commit:

```sh
ssh home 'DEPLOY_REF=<previous-good-sha> ~/apps/zoomphone-bridge/scripts/deploy.sh'
```

Because the deploy is a hard reset to a ref, rolling back is just deploying an
older ref. The SQLite DB and `.env` are untouched by the reset (they live in
gitignored `data/` and `.env`).

---

## Troubleshooting

- **Service status / logs:**
  ```sh
  export XDG_RUNTIME_DIR=/run/user/$(id -u)
  systemctl --user status zoomphone-bridge
  journalctl --user -u zoomphone-bridge -n 100 --no-pager
  ```
- **`/health` never goes green:** check the journal for a missing-secret warning
  (`[env] missing required secrets: …`) or a port clash on 8787.
- **`git reset` refuses (local changes):** the box should hold no local edits.
  The script resets hard precisely so a drifted checkout can't block a deploy; if
  it still fails, inspect `git status` in the app dir.
- **Tunnel returns 502:** the Node service is down or not on 8787. Confirm the
  local `/health` first, then the tunnel ingress rule.

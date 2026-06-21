#!/usr/bin/env node
// Clear out stale pending_clips: delete the SQLite rows AND their on-disk audio
// files older than a cutoff. DRY-RUN by default — pass --apply to actually delete.
//
// This exists to purge old "junk" recordings (e.g. the April backlog) that keep
// aging out into GHL review. It opens the SAME SQLite DB the running service
// uses, so the bridge's own stale-sweep and this script see the same rows.
//
// Usage (run on the box, with the service ideally stopped or quiescent):
//   node scripts/cleanup-stale-clips.mjs                       # dry run, 30-day cutoff
//   node scripts/cleanup-stale-clips.mjs --older-than-days 60  # dry run, 60-day cutoff
//   node scripts/cleanup-stale-clips.mjs --apply               # actually delete
//   BRIDGE_DB_PATH=/path/bridge.db node scripts/cleanup-stale-clips.mjs --apply
//
// DB path resolution (first that is set): BRIDGE_DB_PATH, DB_PATH, else
// ./data/bridge.db — matching src/runtime/env.ts. Clip files live in clips/ next
// to the DB (matching src/runtime/env.ts), but each row also stores its own
// file_path, which is authoritative.
//
// No external dependencies: built-in node:sqlite (Node >= 22.5; the box is Node 24).

import { DatabaseSync } from "node:sqlite";
import { existsSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const args = { apply: false, olderThanDays: 30, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--older-than-days") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0) fail(`--older-than-days needs a non-negative number, got: ${argv[i]}`);
      args.olderThanDays = v;
    } else if (a.startsWith("--older-than-days=")) {
      const v = Number(a.split("=")[1]);
      if (!Number.isFinite(v) || v < 0) fail(`--older-than-days needs a non-negative number, got: ${a}`);
      args.olderThanDays = v;
    } else {
      fail(`unknown argument: ${a}`);
    }
  }
  return args;
}

function fail(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(2);
}

function usage() {
  console.log(`
cleanup-stale-clips — purge old pending_clips rows + their on-disk audio.

  --older-than-days <n>   delete clips created more than n days ago (default 30)
  --apply                 actually delete (default is DRY RUN: report only)
  -h, --help              show this help

DB path: $BRIDGE_DB_PATH | $DB_PATH | ./data/bridge.db
`);
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtAge(ms) {
  const days = ms / (24 * 60 * 60 * 1000);
  return `${days.toFixed(1)}d`;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

const dbPath = resolve(process.env.BRIDGE_DB_PATH ?? process.env.DB_PATH ?? "./data/bridge.db");
if (!existsSync(dbPath)) fail(`SQLite DB not found at ${dbPath} (set BRIDGE_DB_PATH/DB_PATH)`);

const cutoffMs = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;

console.log("── cleanup-stale-clips ──");
console.log(`DB:        ${dbPath}`);
console.log(`Cutoff:    older than ${args.olderThanDays} day(s)  (created_at <= ${new Date(cutoffMs).toISOString()})`);
console.log(`Mode:      ${args.apply ? "APPLY (will delete)" : "DRY RUN (no changes)"}`);
console.log("");

const db = new DatabaseSync(dbPath);

// Be resilient: if the table doesn't exist yet, there's simply nothing to do.
const hasTable = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_clips'")
  .get();
if (!hasTable) {
  console.log("No pending_clips table — nothing to clean.");
  db.close();
  process.exit(0);
}

const rows = db
  .prepare("SELECT client_call_id, file_path, created_at FROM pending_clips WHERE created_at <= ? ORDER BY created_at ASC")
  .all(cutoffMs);

if (rows.length === 0) {
  console.log("No stale clips found. Nothing to do.");
  db.close();
  process.exit(0);
}

let filesFound = 0;
let filesMissing = 0;
let bytesOnDisk = 0;
const now = Date.now();

console.log(`Found ${rows.length} stale clip row(s):\n`);
for (const r of rows) {
  let sizeStr = "(file missing)";
  if (r.file_path && existsSync(r.file_path)) {
    try {
      const size = statSync(r.file_path).size;
      bytesOnDisk += size;
      filesFound++;
      sizeStr = fmtBytes(size);
    } catch {
      filesMissing++;
    }
  } else {
    filesMissing++;
  }
  console.log(
    `  ${r.client_call_id}  age ${fmtAge(now - Number(r.created_at))}  ${sizeStr}  ${r.file_path ?? "(no path)"}`,
  );
}

console.log("");
console.log(`Summary: ${rows.length} row(s), ${filesFound} file(s) on disk (${fmtBytes(bytesOnDisk)}), ${filesMissing} file(s) missing.`);

if (!args.apply) {
  console.log("\nDRY RUN — nothing deleted. Re-run with --apply to delete the above.");
  db.close();
  process.exit(0);
}

// APPLY: delete on-disk files first, then the rows (so a crash mid-run never
// leaves a row pointing at a deleted file with the bytes gone but row intact;
// worst case is an orphaned file the next run still sees via its row... so do
// the row delete in the same loop, per clip).
let rowsDeleted = 0;
let filesDeleted = 0;
const del = db.prepare("DELETE FROM pending_clips WHERE client_call_id = ?");
for (const r of rows) {
  if (r.file_path) {
    try {
      rmSync(r.file_path, { force: true });
      filesDeleted++;
    } catch (err) {
      console.error(`  ! failed to delete file ${r.file_path}: ${err?.message ?? err}`);
    }
  }
  const res = del.run(r.client_call_id);
  rowsDeleted += Number(res.changes ?? 0);
}

console.log("");
console.log(`Deleted ${rowsDeleted} row(s) and ${filesDeleted} file(s) (freed ~${fmtBytes(bytesOnDisk)}).`);
db.close();

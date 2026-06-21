import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/index";
import { resolveRepUserId } from "../src/reps";
import { makeRig, TEST_SHARED_TOKEN } from "./helpers";

const admin = (method: string, path: string, body?: unknown, token = TEST_SHARED_TOKEN) =>
  new Request(`https://test.example.com${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

test("resolveRepUserId: passthrough when no mapping, null for empty", async () => {
  const rig = makeRig();
  try {
    assert.equal(await resolveRepUserId(rig.env, "rep-abc"), "rep-abc");
    assert.equal(await resolveRepUserId(rig.env, "  rep-trim  "), "rep-trim");
    assert.equal(await resolveRepUserId(rig.env, ""), null);
    assert.equal(await resolveRepUserId(rig.env, "   "), null);
    assert.equal(await resolveRepUserId(rig.env, null), null);
    assert.equal(await resolveRepUserId(rig.env, undefined), null);
  } finally {
    rig.cleanup();
  }
});

test("resolveRepUserId: returns mapped userId when one is stored", async () => {
  const rig = makeRig();
  try {
    await handleRequest(admin("POST", "/admin/reps", { repKey: "dev-1", ghlUserId: "U_ONE" }), rig.env, rig.ctx);
    assert.equal(await resolveRepUserId(rig.env, "dev-1"), "U_ONE");
    // A different, unmapped key still passes through.
    assert.equal(await resolveRepUserId(rig.env, "dev-2"), "dev-2");
  } finally {
    rig.cleanup();
  }
});

test("admin/reps: POST upserts, GET lists, DELETE removes", async () => {
  const rig = makeRig();
  try {
    let res = await handleRequest(admin("POST", "/admin/reps", { repKey: "dev-a", ghlUserId: "U_A" }), rig.env, rig.ctx);
    assert.equal(res.status, 200);
    res = await handleRequest(admin("POST", "/admin/reps", { repKey: "dev-b", ghlUserId: "U_B" }), rig.env, rig.ctx);
    assert.equal(res.status, 200);

    res = await handleRequest(admin("GET", "/admin/reps"), rig.env, rig.ctx);
    assert.equal(res.status, 200);
    const list = (await res.json()) as { reps: { repKey: string; ghlUserId: string }[] };
    assert.equal(list.reps.length, 2);
    const byKey = Object.fromEntries(list.reps.map((r) => [r.repKey, r.ghlUserId]));
    assert.equal(byKey["dev-a"], "U_A");
    assert.equal(byKey["dev-b"], "U_B");

    // Upsert overwrites.
    await handleRequest(admin("POST", "/admin/reps", { repKey: "dev-a", ghlUserId: "U_A2" }), rig.env, rig.ctx);
    assert.equal(await resolveRepUserId(rig.env, "dev-a"), "U_A2");

    // DELETE.
    res = await handleRequest(admin("DELETE", "/admin/reps/dev-a"), rig.env, rig.ctx);
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { deleted: boolean }).deleted, true);
    assert.equal(await resolveRepUserId(rig.env, "dev-a"), "dev-a"); // back to passthrough
  } finally {
    rig.cleanup();
  }
});

test("admin/reps: unauthorized without the bearer token", async () => {
  const rig = makeRig();
  try {
    let res = await handleRequest(admin("GET", "/admin/reps", undefined, ""), rig.env, rig.ctx);
    assert.equal(res.status, 401);
    res = await handleRequest(admin("POST", "/admin/reps", { repKey: "x", ghlUserId: "y" }, "wrong"), rig.env, rig.ctx);
    assert.equal(res.status, 401);
  } finally {
    rig.cleanup();
  }
});

test("admin/reps: POST validates body", async () => {
  const rig = makeRig();
  try {
    let res = await handleRequest(admin("POST", "/admin/reps", { repKey: "x" }), rig.env, rig.ctx);
    assert.equal(res.status, 400);
    res = await handleRequest(admin("POST", "/admin/reps", { ghlUserId: "y" }), rig.env, rig.ctx);
    assert.equal(res.status, 400);
  } finally {
    rig.cleanup();
  }
});

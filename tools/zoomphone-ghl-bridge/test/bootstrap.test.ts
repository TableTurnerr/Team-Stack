import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/index";
import { makeRig, TEST_SHARED_TOKEN } from "./helpers";

const get = (token?: string) =>
  new Request("https://test.example.com/agent/bootstrap", {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

test("agent/bootstrap: returns Zoom S2S creds with a valid token", async () => {
  const rig = makeRig();
  try {
    const res = await handleRequest(get(TEST_SHARED_TOKEN), rig.env, rig.ctx);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { zoom: Record<string, string> };
    assert.deepEqual(body.zoom, {
      accountId: "zoom-account",
      clientId: "zoom-client",
      clientSecret: "zoom-client-secret",
      zoomUserId: "rep@test.example.com",
    });
  } finally {
    rig.cleanup();
  }
});

test("agent/bootstrap: unauthorized without / with wrong token", async () => {
  const rig = makeRig();
  try {
    assert.equal((await handleRequest(get(), rig.env, rig.ctx)).status, 401);
    assert.equal((await handleRequest(get("wrong"), rig.env, rig.ctx)).status, 401);
  } finally {
    rig.cleanup();
  }
});

test("agent/bootstrap: 503 when Zoom S2S is not fully configured", async () => {
  const rig = makeRig();
  try {
    rig.env.ZOOM_USER_ID = "";
    const res = await handleRequest(get(TEST_SHARED_TOKEN), rig.env, rig.ctx);
    assert.equal(res.status, 503);
  } finally {
    rig.cleanup();
  }
});

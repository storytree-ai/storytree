import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { createPostHogTransport, type DeliveryEvent } from "./posthog.js";

const event: DeliveryEvent = {
  uuid: "019901ab-1234-7000-8000-0123456789ab",
  distinctId: "019901aa-1234-7000-8000-0123456789ab",
  event: "first_launch",
  timestamp: "2026-10-03T07:00:00.000Z",
  properties: { app_version: "0.3.0" },
};

function requestBody(init?: RequestInit): Record<string, unknown> {
  const raw = init?.body;
  const text = typeof raw === "string" ? raw : gunzipSync(raw as Uint8Array).toString("utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

test("2.2 Node transport sends one US request without IP, person enrichment, or flags", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport = createPostHogTransport({
    projectKey: "phc_test_only",
    permitted: () => true,
    fetch: async (url, init) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      return Response.json({ status: 1 });
    },
  });
  await transport.send(event);
  await transport.close();
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]!.url).origin, "https://us.i.posthog.com");
  assert.equal(new URL(calls[0]!.url).pathname, "/batch/");
  assert.equal(calls[0]!.init!.redirect, "error");
  const body = requestBody(calls[0]!.init);
  assert.equal(body.api_key, "phc_test_only");
  const batch = body.batch as Array<Record<string, unknown>>;
  assert.equal(batch.length, 1);
  const sent = batch[0]!;
  assert.equal(sent.uuid, event.uuid);
  assert.equal(sent.event, event.event);
  assert.equal(sent.distinct_id, event.distinctId);
  assert.equal(sent.timestamp, event.timestamp);
  assert.deepEqual(sent.properties, {
    app_version: "0.3.0",
    $geoip_disable: true,
    $lib: "posthog-node",
    $lib_version: "5.55.0",
    $is_server: true,
  });
});

test("2.2, 2.3 missing configuration or revoked permission cannot issue a request", async () => {
  let requests = 0;
  const fetch: typeof globalThis.fetch = async () => {
    requests += 1;
    return Response.json({ status: 1 });
  };
  const unconfigured = createPostHogTransport({ projectKey: "", permitted: () => true, fetch });
  await assert.rejects(unconfigured.send(event), /Journey event delivery unavailable/);
  await unconfigured.close();
  let checks = 0;
  const revoked = createPostHogTransport({ projectKey: "phc_test_only", permitted: () => ++checks === 1, fetch });
  await assert.rejects(revoked.send(event), /Journey event delivery unavailable/);
  await revoked.close();
  assert.ok(checks >= 2, "permission is checked again at HTTP boundary");
  assert.equal(requests, 0);
});

test("2.1, 2.3 failed sends reject safely without background retry and close refuses later sends", async () => {
  let requests = 0;
  const transport = createPostHogTransport({
    projectKey: "phc_secret_test_marker",
    permitted: () => true,
    fetch: async () => {
      requests += 1;
      throw new Error("network failure carrying phc_secret_test_marker");
    },
  });
  await assert.rejects(transport.send(event), { message: "Journey event delivery unavailable" });
  await transport.close();
  await assert.rejects(transport.send(event), { message: "Journey event delivery unavailable" });
  assert.equal(requests, 1);
});

test("2.2 corrupt queue rows cannot widen the journey payload", async () => {
  let requests = 0;
  const transport = createPostHogTransport({
    projectKey: "phc_test_only", permitted: () => true,
    fetch: async () => { requests += 1; return Response.json({ status: 1 }); },
  });
  for (const invalid of [
    { ...event, event: "private code" },
    { ...event, distinctId: "person@example.com" },
    { ...event, properties: { app_version: "private code" } },
    { ...event, properties: { app_version: "0.3.0", conversation: "private code" } },
    { ...event, timestamp: "private code" },
  ]) await assert.rejects(transport.send(invalid), { message: "Journey event delivery unavailable" });
  await transport.close();
  assert.equal(requests, 0);
});

test("2.1 an acknowledgement over a distant link (over a second, as measured to PostHog US) counts as delivered", async () => {
  const transport = createPostHogTransport({
    projectKey: "phc_test_only", permitted: () => true,
    fetch: async () => { await new Promise(resolve => setTimeout(resolve, 1_500)); return Response.json({ status: 1 }); },
  });
  await transport.send(event);
  await transport.close();
});

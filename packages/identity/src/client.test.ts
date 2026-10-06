import assert from "node:assert/strict";
import { test } from "node:test";
import { createIdentityClient, type SessionStore } from "./client.js";

const identityUrl = "https://identity.example.test/v1/identity";
const user = { id: "76c80829-6cfd-4f1e-95e8-9a9c781529ce", email: "first@example.test" };
const clientId = "client_test";
const credentials = { access_token: "access-private", refresh_token: "refresh-private" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function journey() {
  let saved: string | undefined;
  let time = 0;
  let reads = 0;
  let writes = 0;
  const waits: number[] = [];
  const shown: unknown[] = [];
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const answers: Response[] = [];
  const store: SessionStore = {
    async read() { reads++; return saved; },
    async write(value) { writes++; saved = value; },
    async clear() { saved = undefined; },
  };
  const open = () => createIdentityClient({ clientId, identityUrl, store,
    now: () => time,
    wait: async (ms, signal) => { signal.throwIfAborted(); waits.push(ms); time += ms; },
    fetch: async (input, init) => {
      requests.push({ url: String(input), init });
      assert.equal(init?.redirect, "error");
      return answers.shift() ?? response({ error: "unexpected_request" }, 500);
    },
  });
  const device = (change = {}) => response({ device_code: "device-private", user_code: "ABCD-EFGH",
    verification_uri: "https://example.authkit.app/device", expires_in: 300, interval: 5, ...change });
  return { open, device, answers, waits, shown, requests, store,
    show: (value: unknown) => { shown.push(value); },
    saved: () => saved, reads: () => reads, writes: () => writes,
  };
}

test("2.2 device authorization exposes only the user code, obeys pending and slow_down, and waits for the Storytree identity", async () => {
  const j = journey();
  j.answers.push(j.device(), response({ error: "authorization_pending" }, 400), response({ error: "slow_down" }, 400), response(credentials), response({ ...user, workosUserId: "must-not-display", identities: ["private"] }));
  assert.deepEqual(await j.open().signIn(j.show), user);
  assert.deepEqual(j.shown, [{ userCode: "ABCD-EFGH", verificationUri: "https://example.authkit.app/device" }]);
  assert.deepEqual(j.waits, [5000, 5000, 10000]);
  assert.equal(j.saved(), "refresh-private");
  const first = j.requests[0]!;
  assert.equal(first.url, "https://api.workos.com/user_management/authorize/device");
  assert.equal(String(first.init?.body), "client_id=client_test");
  for (const request of j.requests.slice(1, 4)) {
    const body = new URLSearchParams(String(request.init?.body));
    assert.equal(body.get("device_code"), "device-private");
    assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
    assert.equal(body.has("client_secret"), false);
  }
  assert.equal(j.requests[4]!.url, identityUrl);
  assert.equal(new Headers(j.requests[4]!.init?.headers).get("authorization"), "Bearer access-private");
});

test("2.2 denied, expired, cancelled, malformed or unverified device flows leave no saved session or leaked upstream text", async () => {
  for (const code of ["access_denied", "expired_token", "unknown_error"]) {
    const j = journey();
    j.answers.push(j.device(), response({ error: code, error_description: "device-private refresh-private access-private" }, 400));
    await assert.rejects(j.open().signIn(j.show), (error: Error) => {
      assert.doesNotMatch(error.message, /private/); return true;
    });
    assert.equal(j.saved(), undefined);
  }
  for (const answer of [response({ ...credentials, refresh_token: "" }), response(credentials)]) {
    const j = journey();
    j.answers.push(j.device(), answer, response({ error: "private" }, 401));
    await assert.rejects(j.open().signIn(j.show));
    assert.equal(j.saved(), undefined);
  }
  const cancelled = journey();
  const controller = new AbortController();
  cancelled.answers.push(cancelled.device());
  await assert.rejects(cancelled.open().signIn(() => controller.abort(), controller.signal), /cancelled/i);
  assert.equal(cancelled.requests.length, 1);
  assert.equal(cancelled.saved(), undefined);
  const timed = journey();
  timed.answers.push(timed.device({ expires_in: 4 }));
  await assert.rejects(timed.open().signIn(timed.show), /expired/i);
  assert.equal(timed.requests.length, 1);
  for (const change of [{ interval: -1 }, { expires_in: 0 }, { verification_uri: "http://example.test/device" }, { user_code: "code\nsecret" }]) {
    const bad = journey(); bad.answers.push(bad.device(change));
    await assert.rejects(bad.open().signIn(bad.show));
    assert.equal(bad.shown.length, 0);
  }
});

test("2.4 status is account-free until sign-in, rotates a restarted session, and local sign-out removes it", async () => {
  const j = journey();
  assert.equal(await j.open().status(), null);
  assert.equal(j.requests.length, 0);
  await j.store.write("old-refresh");
  j.answers.push(response(credentials), response(user));
  assert.deepEqual(await j.open().status(), user);
  assert.equal(new URLSearchParams(String(j.requests[0]!.init?.body)).get("refresh_token"), "old-refresh");
  assert.equal(j.saved(), "refresh-private");
  await j.open().signOut();
  assert.equal(await j.open().status(), null);
  assert.equal(j.requests.length, 2);
});

test("2.4 revoked sessions are discarded; temporary failures keep the latest rotated refresh token without claiming signed in", async () => {
  const j = journey();
  await j.store.write("old-refresh");
  j.answers.push(response({ error: "invalid_grant", error_description: "private" }, 400));
  assert.equal(await j.open().status(), null);
  assert.equal(j.saved(), undefined);
  await j.store.write("old-refresh");
  j.answers.push(response({ error: "private" }, 503));
  await assert.rejects(j.open().status(), /unavailable/i);
  assert.equal(j.saved(), "old-refresh");
  j.answers.push(response(credentials), response({ error: "private" }, 503));
  await assert.rejects(j.open().status(), /unavailable/i);
  assert.equal(j.saved(), "refresh-private");
  j.answers.push(response({ ...credentials, refresh_token: "next-refresh" }), response({}, 401));
  assert.equal(await j.open().status(), null);
  assert.equal(j.saved(), undefined);
});

test("2.4 only an explicit HTTPS identity endpoint can receive access tokens; malformed identity responses never claim signed in", async () => {
  const j = journey();
  for (const url of ["http://localhost:1234/v1/identity", "https://user:password@identity.test", "https://identity.test/?token=a", "https://identity.test/#fragment"]) {
    assert.throws(() => createIdentityClient({ clientId, identityUrl: url, store: j.store }));
  }
  for (const badUser of [{ ...user, id: "user_workos" }, { ...user, email: "private\nlog injection" }, {}]) {
    j.answers.push(j.device(), response(credentials), response(badUser));
    await assert.rejects(j.open().signIn(j.show));
    assert.equal(j.saved(), undefined);
  }
});

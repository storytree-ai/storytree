import assert from "node:assert/strict";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createIdentityClient, type SessionStore } from "./client.js";

const clientId = "client_test";
const jwksUrl = `https://api.workos.com/sso/jwks/${clientId}`;
const user = { id: "user_01FIRST", email: "first@example.test" };
const account = { ...user, email_verified: true, first_name: "must-not-display", profile_picture_url: "private" };
const { privateKey, publicKey } = await generateKeyPair("RS256");
const { privateKey: strangerKey } = await generateKeyPair("RS256");
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A WorkOS access token as its JWT template stamps it, signed by the client's key unless told otherwise. */
const token = (claims: Record<string, unknown> = {}, key = privateKey) => new SignJWT({ sid: "session_01", aud: "storytree-identity", ...claims })
  .setProtectedHeader({ alg: "RS256", kid: "k1" }).setSubject(user.id).setIssuedAt().setExpirationTime("5m").sign(key);
/** WorkOS's code and refresh exchanges answer with the tokens and the user they belong to. */
const exchange = async (change: Record<string, unknown> = {}, claims: Record<string, unknown> = {}, key = privateKey) =>
  response({ access_token: await token(claims, key), refresh_token: "refresh-private", user: account, ...change });

function journey() {
  let saved: string | undefined;
  let time = 0;
  const waits: number[] = [];
  const shown: unknown[] = [];
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const keyRequests: string[] = [];
  const answers: Response[] = [];
  const keyAnswers: Response[] = [];
  const store: SessionStore = {
    async read() { return saved; },
    async write(value) { saved = value; },
    async clear() { saved = undefined; },
  };
  const open = () => createIdentityClient({ clientId, store,
    now: () => time,
    wait: async (ms, signal) => { signal.throwIfAborted(); waits.push(ms); time += ms; },
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === jwksUrl) { keyRequests.push(url); return keyAnswers.shift() ?? response(jwks); }
      requests.push({ url, init });
      assert.equal(init?.redirect, "error");
      return answers.shift() ?? response({ error: "unexpected_request" }, 500);
    },
  });
  const device = (change = {}) => response({ device_code: "device-private", user_code: "ABCD-EFGH",
    verification_uri: "https://example.authkit.app/device", expires_in: 300, interval: 5, ...change });
  return { open, device, answers, keyAnswers, waits, shown, requests, keyRequests, store,
    show: (value: unknown) => { shown.push(value); },
    saved: () => saved,
  };
}

test("2.2 device authorization exposes only the user code, obeys pending and slow_down, and verifies WorkOS's token itself", async () => {
  const j = journey();
  j.answers.push(j.device(), response({ error: "authorization_pending" }, 400), response({ error: "slow_down" }, 400), await exchange());
  assert.deepEqual(await j.open().signIn(j.show), user);
  assert.deepEqual(j.shown, [{ userCode: "ABCD-EFGH", verificationUri: "https://example.authkit.app/device" }]);
  assert.deepEqual(j.waits, [5000, 5000, 10000]);
  assert.equal(j.saved(), "refresh-private");
  const first = j.requests[0]!;
  assert.equal(first.url, "https://api.workos.com/user_management/authorize/device");
  assert.equal(String(first.init?.body), "client_id=client_test");
  for (const request of j.requests.slice(1)) {
    assert.equal(request.url, "https://api.workos.com/user_management/authenticate");
    const body = new URLSearchParams(String(request.init?.body));
    assert.equal(body.get("device_code"), "device-private");
    assert.equal(body.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
    assert.equal(body.has("client_secret"), false);
  }
  assert.equal(j.requests.length, 4, "no identity server is asked who the token belongs to");
  assert.deepEqual(j.keyRequests, [jwksUrl], "checked against the client's own published keys");
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

test("2.2 a token or user that does not verify never claims signed in and saves nothing", async () => {
  const refusals = [
    () => exchange({ refresh_token: "" }),
    () => exchange({}, {}, strangerKey),
    () => exchange({}, { aud: "someone-else" }),
    () => exchange({}, { client_id: "client_other" }),
    () => exchange({ user: { ...account, id: "user_01SOMEONEELSE" } }),
    () => exchange({ user: { ...account, email_verified: false } }),
    () => exchange({ user: { ...account, email: "private\nlog injection" } }),
    () => exchange({ user: undefined }),
    () => exchange({ access_token: "not-a-token" }),
  ];
  for (const refusal of refusals) {
    const j = journey();
    j.answers.push(j.device(), await refusal());
    await assert.rejects(j.open().signIn(j.show), /could not be verified/i);
    assert.equal(j.saved(), undefined);
  }
});

test("2.4 status is account-free until sign-in, rotates a restarted session, and local sign-out removes it", async () => {
  const j = journey();
  assert.equal(await j.open().status(), null);
  assert.equal(j.requests.length, 0);
  await j.store.write("old-refresh");
  j.answers.push(await exchange());
  assert.deepEqual(await j.open().status(), user);
  assert.equal(new URLSearchParams(String(j.requests[0]!.init?.body)).get("refresh_token"), "old-refresh");
  assert.equal(j.saved(), "refresh-private");
  await j.open().signOut();
  assert.equal(await j.open().status(), null);
  assert.equal(j.requests.length, 1);
});

test("2.4 revoked or unverifiable sessions are discarded; temporary failures keep the latest rotated refresh token without claiming signed in", async () => {
  const j = journey();
  await j.store.write("old-refresh");
  j.answers.push(response({ error: "invalid_grant", error_description: "private" }, 400));
  assert.equal(await j.open().status(), null);
  assert.equal(j.saved(), undefined);
  await j.store.write("old-refresh");
  j.answers.push(response({ error: "private" }, 503));
  await assert.rejects(j.open().status(), /unavailable/i);
  assert.equal(j.saved(), "old-refresh");
  j.answers.push(await exchange());
  j.keyAnswers.push(response({ error: "private" }, 503));
  await assert.rejects(j.open().status(), /unavailable/i);
  assert.equal(j.saved(), "refresh-private", "keys that could not be fetched keep the rotated session");
  j.answers.push(await exchange({ refresh_token: "next-refresh" }, {}, strangerKey));
  assert.equal(await j.open().status(), null);
  assert.equal(j.saved(), undefined);
});

test("2.4 sign-in needs only a public WorkOS client ID; an identity endpoint, if still given, must be HTTPS and is never called", async () => {
  const j = journey();
  for (const id of ["", "sk_live_secret"]) assert.throws(() => createIdentityClient({ clientId: id, store: j.store }));
  for (const url of ["http://localhost:1234/v1/identity", "https://user:password@identity.test", "https://identity.test/?token=a", "https://identity.test/#fragment"]) {
    assert.throws(() => createIdentityClient({ clientId, identityUrl: url, store: j.store }), /HTTPS identity endpoint/);
  }
  assert.doesNotThrow(() => createIdentityClient({ clientId, identityUrl: "https://identity.test/v1/identity", store: j.store }));
});

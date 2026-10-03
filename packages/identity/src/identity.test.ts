import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";
import { createIdentityService } from "./index.js";

const clientId = "client_storytree_test";
const issuer = `https://api.workos.com/user_management/${clientId}`;
const audience = "storytree-identity";
const apiKey = "test-server-only-key";
type Identity = { type: string; provider: string; idp_id: string };
const google = (subject: string): Identity => ({ type: "OAuth", provider: "GoogleOAuth", idp_id: subject });
const github = (subject: string): Identity => ({ type: "OAuth", provider: "GithubOAuth", idp_id: subject });
const microsoft = (subject: string): Identity => ({ type: "OAuth", provider: "MicrosoftOAuth", idp_id: subject });

// Real HTTP, signed tokens and an isolated real Postgres schema. The WorkOS server is a
// local protocol stand-in; this is not evidence that the gated staging journey passed.
async function journey() {
  const connectionString = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(connectionString, "run via pnpm run test to provision Postgres");
  const admin = new pg.Pool({ connectionString, max: 1 });
  const schema = `identity_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString, options: `-c search_path=${schema}`, max: 8 });
  const keys = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(keys.publicKey), kid: "staging-test", alg: "RS256", use: "sig" };
  const users = new Map<string, { email: string; email_verified: boolean; identities: Identity[]; id?: string }>();
  const requests: string[] = [];
  let failure = 0;
  const server = createServer((req, res) => {
    requests.push(req.url ?? "");
    res.setHeader("Content-Type", "application/json");
    if (req.url === `/sso/jwks/${clientId}`) { res.end(JSON.stringify({ keys: [jwk] })); return; }
    assert.equal(req.headers.authorization, `Bearer ${apiKey}`);
    if (failure) { res.writeHead(failure); res.end(JSON.stringify({ message: `private ${apiKey}` })); return; }
    const match = /^\/user_management\/users\/([^/]+)(\/identities)?$/.exec(req.url ?? "");
    const id = match?.[1];
    const user = id === undefined ? undefined : users.get(id);
    if (!user) { res.writeHead(404); res.end("{}"); return; }
    res.end(JSON.stringify(match?.[2] ? user.identities : { id, ...user, identities: undefined }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.workos.com");
    return fetch(`${base}${url.pathname}${url.search}`, init);
  };
  const open = (storePool = pool) => createIdentityService({ pool: storePool, clientId, issuer, audience, apiKey, fetch: transport });
  const service = open();
  await service.initialize();
  const token = (sub: string, changes: Record<string, unknown> = {}, signer = keys.privateKey) => new SignJWT({
    iss: issuer, aud: audience, sub, sid: "session_test", iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300, ...changes,
  }).setProtectedHeader({ alg: "RS256", kid: "staging-test" }).sign(signer);
  const put = (id: string, identities: Identity[], email = "first@example.test") => {
    users.set(id, { email, email_verified: true, identities });
  };
  const snapshot = async () => ({
    users: (await pool.query("SELECT * FROM storytree_users ORDER BY id")).rows,
    identities: (await pool.query("SELECT * FROM storytree_user_identities ORDER BY provider, subject")).rows,
  });
  return { pool, service, open, users, requests, token, put, snapshot,
    fail: (status: number) => { failure = status; },
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

test("1.1 portable user identity persists its own id, first verified email and every provider subject across reopening", async () => {
  const j = await journey();
  try {
    j.put("user_first", [google("g1"), github("h1"), microsoft("m1")]);
    const token = await j.token("user_first");
    const first = await j.service.resolve(token);
    assert.match(first.id, /^[0-9a-f-]{36}$/);
    assert.notEqual(first.id, "user_first");
    assert.equal(first.firstVerifiedEmail, "first@example.test");
    assert.equal(first.workosUserId, "user_first");
    assert.deepEqual(first.identities, [
      { provider: "github", subject: "h1" }, { provider: "google", subject: "g1" }, { provider: "microsoft", subject: "m1" },
    ]);
    assert.deepEqual(await j.open().resolve(token), first);
  } finally { await j.close(); }
});

test("1.2 provider+subject survives email and WorkOS replacement; equal email alone never joins users", async () => {
  const j = await journey();
  try {
    j.put("user_old", [google("stable")]);
    const first = await j.service.resolve(await j.token("user_old"));
    j.put("user_replacement", [google("stable")], "changed@example.test");
    const returning = await j.service.resolve(await j.token("user_replacement"));
    assert.equal(returning.id, first.id);
    assert.equal(returning.firstVerifiedEmail, first.firstVerifiedEmail);
    assert.equal(returning.workosUserId, "user_replacement");
    j.put("user_unrelated", [google("different")]);
    assert.notEqual((await j.service.resolve(await j.token("user_unrelated"))).id, first.id);
    j.put("user_another_provider", [github("stable")]);
    assert.notEqual((await j.service.resolve(await j.token("user_another_provider"))).id, first.id);
  } finally { await j.close(); }
});

test("1.3 linked identities join atomically; evidence joining two existing people refuses with no writes", async () => {
  const j = await journey();
  try {
    j.put("user_a", [google("a")]);
    const a = await j.service.resolve(await j.token("user_a"));
    j.put("user_a", [google("a"), github("new")]);
    const linked = await j.service.resolve(await j.token("user_a"));
    assert.equal(linked.id, a.id);
    assert.equal(linked.identities.length, 2);
    j.put("user_b", [microsoft("b")]);
    await j.service.resolve(await j.token("user_b"));
    const before = await j.snapshot();
    j.put("user_joined", [google("a"), microsoft("b"), github("must-not-write")]);
    await assert.rejects(j.service.resolve(await j.token("user_joined")), /identity conflict/i);
    assert.deepEqual(await j.snapshot(), before);
  } finally { await j.close(); }
});

test("1.4 concurrent resolutions create one durable user for one provider+subject", async () => {
  const j = await journey();
  try {
    j.put("user_race", [google("same")]);
    const token = await j.token("user_race");
    const results = await Promise.all(Array.from({ length: 8 }, () => j.open().resolve(token)));
    assert.equal(new Set(results.map((result) => result.id)).size, 1);
    const saved = await j.snapshot();
    assert.equal(saved.users.length, 1);
    assert.equal(saved.identities.length, 1);
  } finally { await j.close(); }
});

test("1.5 invalid WorkOS tokens or identity evidence fail closed before writes and never expose secrets", async () => {
  const j = await journey();
  try {
    j.put("user_valid", [google("valid")]);
    const otherKey = await generateKeyPair("RS256");
    const invalidTokens = ["not-a-jwt",
      await j.token("user_valid", { exp: 1 }),
      await j.token("user_valid", { nbf: Math.floor(Date.now() / 1000) + 600 }),
      await j.token("user_valid", { iss: "https://attacker.example" }),
      await j.token("user_valid", { aud: "another-app" }),
      await j.token("user_valid", { aud: undefined }),
      await j.token("user_valid", { sub: undefined }),
      await j.token("user_valid", { sid: undefined }),
      await j.token("user_valid", { client_id: "client_wrong" }),
      await j.token("user_valid", {}, otherKey.privateKey),
    ];
    for (const token of invalidTokens) await assert.rejects(j.service.resolve(token), /sign-in could not be verified/i);
    assert.equal(j.requests.some((path) => path.includes("/users/")), false, "invalid token never reaches user APIs");
    const token = await j.token("user_valid");
    for (const change of [
      { email_verified: false }, { email: "" }, { id: "user_someone_else" }, { identities: [] },
      { identities: [{ type: "OAuth", provider: "AppleOAuth", idp_id: "apple" }] },
      { identities: [{ type: "SSO", provider: "GoogleOAuth", idp_id: "g" }] },
      { identities: [google("")] }, { identities: [google("valid"), github("")] },
    ]) {
      j.put("user_valid", [google("valid")]);
      Object.assign(j.users.get("user_valid")!, change);
      await assert.rejects(j.service.resolve(token), /sign-in could not be verified/i);
    }
    j.fail(503);
    await assert.rejects(j.service.resolve(token), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /test-server-only-key|private/);
      return /sign-in could not be verified/i.test(error.message);
    });
    assert.deepEqual(await j.snapshot(), { users: [], identities: [] });
    j.fail(0);
    j.put("user_valid", [google("valid")]);
    const unavailable = new pg.Pool();
    await unavailable.end();
    await assert.rejects(j.open(unavailable).resolve(token), { message: "Storytree could not save your identity. Try again later." });
  } finally { await j.close(); }
});

/** Capability 1 · The address and its guards, contracts 1.15-1.19: the owner's sign-in for signed tools, while reads stay open. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type net from "node:net";
import { after, before, test } from "node:test";
import { SignJWT, exportJWK } from "jose";

import { main } from "./bins/voice.js";
import { SIGNED_TOOL_NAMES } from "./signin.js";
import { LEGACY_HEADERS, MCP_HEADERS, connect, gitRepo, messagesOf, raw, seen, testDoor, textOf, toolCall } from "./testing/door.js";

const repo = gitRepo({ "README.md": "voice test repository\n" });
const PUBLIC_URL = "https://voice-box.example-tailnet.ts.net";
const ISSUER = "https://voice-test-staging.authkit.app";
const OWNER = "user_01OWNERTESTID";

// A stand-in sign-in service: its published keys, served locally, and tokens signed with its private key.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
let keys: http.Server;
let jwksUrl = "";
before(async () => {
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  keys = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((done) => keys.listen(0, "127.0.0.1", () => done()));
  jwksUrl = `http://127.0.0.1:${(keys.address() as net.AddressInfo).port}/oauth2/jwks`;
});
after(async () => {
  keys.closeAllConnections();
  keys.close();
  await repo.remove();
});

const signInEnv = () => ({ VOICE_SIGNIN_ISSUER: ISSUER, VOICE_PUBLIC_URL: PUBLIC_URL, VOICE_OWNER_ID: OWNER, VOICE_SIGNIN_JWKS: jwksUrl });

interface Claims { sub?: string; iss?: string; aud?: string; expiresIn?: number; key?: crypto.KeyObject }
async function tokenFor(audience: string, { sub = OWNER, iss = ISSUER, aud = audience, expiresIn = 300, key = privateKey }: Claims = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ client_id: "client_test" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject(sub)
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + expiresIn)
    .sign(key);
}

const MCP_HEADERS_2025 = { ...MCP_HEADERS, "mcp-protocol-version": "2025-06-18" };
const metadataPath = (route: string) => `/.well-known/oauth-protected-resource${route}`;

test("1.15 with no sign-in configured no signed tool is registered and the metadata path is a bare 404; sign-in settings come all together or the door refuses to start", async () => {
  const door = await testDoor(repo.dir);
  try {
    const client = await connect(door.port, door.token);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const signed of SIGNED_TOOL_NAMES) assert.ok(!names.includes(signed), `${signed} is registered without a sign-in service`);
    await client.close();
    const call = await raw(door.port, { urlPath: door.route, headers: LEGACY_HEADERS, body: toolCall(1, "who_am_i") });
    assert.notEqual(call.status, 401, "a call asked for a sign-in no service is configured for");
    const metadata = await raw(door.port, { method: "GET", urlPath: metadataPath(door.route) });
    assert.equal(metadata.status, 404);
    assert.equal(metadata.body, "");
  } finally {
    await door.close();
  }

  const full = signInEnv();
  const cases: Array<[string, Record<string, string>, RegExp]> = [
    ["only the issuer", { VOICE_SIGNIN_ISSUER: ISSUER }, /VOICE_PUBLIC_URL/],
    ["no owner", { ...full, VOICE_OWNER_ID: "" }, /VOICE_OWNER_ID/],
    ["an http issuer", { ...full, VOICE_SIGNIN_ISSUER: "http://voice-test.authkit.app" }, /VOICE_SIGNIN_ISSUER/],
    ["a public address with a path", { ...full, VOICE_PUBLIC_URL: `${PUBLIC_URL}/mcp` }, /VOICE_PUBLIC_URL/],
    ["an owner that is not a user id", { ...full, VOICE_OWNER_ID: "mick@example.com" }, /VOICE_OWNER_ID/],
  ];
  for (const [label, env, why] of cases) {
    let stderr = "";
    const exits: number[] = [];
    const refused = await main({ PORT: "0", REPO_DIR: repo.dir, VOICE_TOKEN: "t".repeat(40), ...env }, { stderr: (line) => (stderr += line), exit: (code) => exits.push(code) });
    assert.equal(refused, undefined, label);
    assert.deepEqual(exits, [1], label);
    assert.match(stderr, why, label);
  }
});

test("1.16 with sign-in configured the door publishes protected-resource metadata on the secret's well-known path, naming the connector's exact address; other well-known paths stay 404", async () => {
  const door = await testDoor(repo.dir, signInEnv());
  try {
    const answer = await raw(door.port, { method: "GET", urlPath: metadataPath(door.route) });
    assert.equal(answer.status, 200);
    assert.match(String(answer.headers["content-type"]), /^application\/json/);
    const metadata = JSON.parse(answer.body) as { resource: string; authorization_servers: string[]; bearer_methods_supported: string[] };
    assert.equal(metadata.resource, `${PUBLIC_URL}${door.route}`);
    assert.deepEqual(metadata.authorization_servers, [ISSUER]);
    assert.deepEqual(metadata.bearer_methods_supported, ["header"]);
    for (const urlPath of ["/.well-known/oauth-protected-resource", metadataPath(`/mcp/${"x".repeat(48)}`), `${metadataPath(door.route)}/extra`, "/.well-known/oauth-authorization-server"]) {
      const other = await raw(door.port, { method: "GET", urlPath });
      assert.equal(other.status, 404, urlPath.replace(door.token, "<token>"));
      assert.equal(other.body, "");
    }
  } finally {
    await door.close();
  }
});

test("1.17 a signed tool's call with no token or a bad, foreign, misaddressed or expired one is 401 with a Bearer challenge naming the metadata, and runs no tool", async () => {
  const door = await testDoor(repo.dir, signInEnv());
  try {
    const resource = `${PUBLIC_URL}${door.route}`;
    const tokens: Array<[string, string | undefined]> = [
      ["no token", undefined],
      ["not a token", "not-a-jwt"],
      ["signed by another key", await tokenFor(resource, { key: stranger.privateKey })],
      ["another issuer", await tokenFor(resource, { iss: "https://someone-else.authkit.app" })],
      ["another audience", await tokenFor(resource, { aud: `${PUBLIC_URL}/mcp/${"y".repeat(48)}` })],
      ["expired", await tokenFor(resource, { expiresIn: -120 })],
    ];
    for (const [label, token] of tokens) {
      const headers = { ...LEGACY_HEADERS, ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) };
      const answer = await raw(door.port, { urlPath: door.route, headers, body: toolCall(1, "who_am_i") });
      assert.equal(answer.status, 401, label);
      const challenge = String(answer.headers["www-authenticate"]);
      assert.match(challenge, /^Bearer /, label);
      assert.ok(challenge.includes(`resource_metadata="${PUBLIC_URL}${metadataPath(door.route)}"`), `${label}: ${challenge.replace(door.token, "<token>")}`);
      if (token !== undefined) assert.match(challenge, /error="invalid_token"/, label);
      assert.ok(!messagesOf(answer.body).some((message) => message.result), `${label}: a tool answered`);
    }
  } finally {
    await door.close();
  }
});

test("1.18 a valid token for anyone but the owner is 403; the owner's valid token runs the signed tool, which knows it is him", async () => {
  const door = await testDoor(repo.dir, signInEnv());
  try {
    const resource = `${PUBLIC_URL}${door.route}`;
    const other = await raw(door.port, { urlPath: door.route, headers: { ...LEGACY_HEADERS, authorization: `Bearer ${await tokenFor(resource, { sub: "user_01SOMEONEELSE" })}` }, body: toolCall(1, "who_am_i") });
    assert.equal(other.status, 403);
    assert.ok(!messagesOf(other.body).some((message) => message.result), "a tool answered a stranger");

    const owner = await tokenFor(resource);
    const client = await connect(door.port, door.token, undefined, { authorization: `Bearer ${owner}` });
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const signed of SIGNED_TOOL_NAMES) assert.ok(names.includes(signed), `${signed} is not registered with a sign-in service`);
    const result = await client.callTool({ name: "who_am_i", arguments: {} });
    assert.notEqual(result.isError, true, textOf(result as never));
    assert.match(textOf(result as never), new RegExp(OWNER));
    await client.close();
  } finally {
    await door.close();
  }
});

test("1.19 reads never look at the token: a read with no token, a bad one or an expired one is served, even when the sign-in keys cannot be reached", async () => {
  const door = await testDoor(repo.dir, { ...signInEnv(), VOICE_SIGNIN_JWKS: "http://127.0.0.1:9/unreachable" });
  try {
    const expired = await tokenFor(`${PUBLIC_URL}${door.route}`, { expiresIn: -120 });
    for (const authorization of [undefined, "Bearer not-a-jwt", `Bearer ${expired}`]) {
      const headers = { ...LEGACY_HEADERS, ...(authorization === undefined ? {} : { authorization }) };
      const answer = await raw(door.port, { urlPath: door.route, headers, body: toolCall(1, "find", { query: "anything" }) });
      assert.equal(answer.status, 200, String(authorization).slice(0, 20));
      assert.equal(seen(messagesOf(answer.body)[0]!.result!).argv.at(-1), "anything");
    }
    const listed = await raw(door.port, { urlPath: door.route, headers: { ...MCP_HEADERS, "mcp-protocol-version": "2025-06-18", authorization: "Bearer not-a-jwt" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
    assert.equal(listed.status, 200);
  } finally {
    await door.close();
  }
});

test("1.20 with VOICE_SIGNIN_EVERY_CALL on, every call without the owner's token is 401 with the challenge, initialize and reads included, so claude.ai signs in at connect time; the owner's token is served; off, reads stay open", async () => {
  const door = await testDoor(repo.dir, { ...signInEnv(), VOICE_SIGNIN_EVERY_CALL: "1" });
  try {
    const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    for (const [label, body] of [["initialize", initialize], ["a read", toolCall(2, "find", { query: "anything" })]] as const) {
      const answer = await raw(door.port, { urlPath: door.route, headers: MCP_HEADERS_2025, body });
      assert.equal(answer.status, 401, label);
      assert.ok(String(answer.headers["www-authenticate"]).includes(`resource_metadata="${PUBLIC_URL}${metadataPath(door.route)}"`), label);
      assert.ok(!messagesOf(answer.body).some((message) => message.result), `${label}: answered without a token`);
    }
    const owner = await tokenFor(`${PUBLIC_URL}${door.route}`);
    const read = await raw(door.port, { urlPath: door.route, headers: { ...LEGACY_HEADERS, authorization: `Bearer ${owner}` }, body: toolCall(3, "find", { query: "anything" }) });
    assert.equal(read.status, 200);
    const other = await raw(door.port, { urlPath: door.route, headers: { ...LEGACY_HEADERS, authorization: `Bearer ${await tokenFor(`${PUBLIC_URL}${door.route}`, { sub: "user_01SOMEONEELSE" })}` }, body: toolCall(4, "find", { query: "anything" }) });
    assert.equal(other.status, 403);
  } finally {
    await door.close();
  }
  const exits: number[] = [];
  const refused = await main({ PORT: "0", REPO_DIR: repo.dir, VOICE_TOKEN: "t".repeat(40), ...signInEnv(), VOICE_SIGNIN_EVERY_CALL: "yes" }, { stderr: () => {}, exit: (code) => exits.push(code) });
  assert.equal(refused, undefined, "a door started with VOICE_SIGNIN_EVERY_CALL=yes");
  assert.deepEqual(exits, [1]);
  for (const value of ["0", ""]) {
    const open = await testDoor(repo.dir, { ...signInEnv(), VOICE_SIGNIN_EVERY_CALL: value });
    try {
      const answer = await raw(open.port, { urlPath: open.route, headers: LEGACY_HEADERS, body: toolCall(1, "find", { query: "anything" }) });
      assert.equal(answer.status, 200, `VOICE_SIGNIN_EVERY_CALL=${value}`);
    } finally {
      await open.close();
    }
  }
});

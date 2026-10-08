import assert from "node:assert/strict";
import { test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { callbackSession, callbackUrls, createFeedbackIdentity, feedbackIdentityConfig, type DesktopSession, type SignInEngine } from "./desktop.js";

const clientId = "client_01DESKTOP";
const jwksUrl = `https://api.workos.com/sso/jwks/${clientId}`;
const account = { id: "user_01FIRST", email: "first@example.test", emailVerified: true };
const user = { id: account.id, email: account.email };
const { privateKey, publicKey } = await generateKeyPair("RS256");
const { privateKey: strangerKey } = await generateKeyPair("RS256");
const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" }] };

/** A WorkOS access token as its JWT template stamps it, signed by the client's key unless told otherwise. */
const token = (claims: Record<string, unknown> = {}, key = privateKey) => new SignJWT({ sid: "session_01", aud: "storytree-identity", ...claims })
  .setProtectedHeader({ alg: "RS256", kid: "k1" }).setSubject(account.id)
  .setIssuedAt().setExpirationTime("5m").sign(key);

/** Stands in for the official desktop SDK: it owns PKCE, the deep link and protected token storage. */
function desktop(protectedStorage = true) {
  let signedIn: { accessToken: string; user: typeof account } | undefined;
  let next: () => Promise<{ accessToken: string; user: typeof account }> = async () => ({ accessToken: await token(), user: account });
  const requests: string[] = [];
  const keyAnswers: Response[] = [];
  let reads = 0;
  const session: DesktopSession = {
    storageProtected: () => protectedStorage,
    async current() { reads++; return signedIn; },
    async signIn() { signedIn = await next(); },
    async signOut() { signedIn = undefined; },
  };
  const open = () => createFeedbackIdentity({ clientId, session,
    fetch: async (input) => {
      requests.push(String(input));
      return keyAnswers.shift() ?? Response.json(jwks);
    },
  });
  return { open, requests, keyAnswers, reads: () => reads, signedIn: () => signedIn,
    signInAs: (make: typeof next) => { next = make; } };
}

test("2.3 a restarted desktop restores its verified account for feedback with only id and email, and sign-out leaves status signed out", async () => {
  const app = desktop();
  assert.equal(await app.open().status(), null, "signed out until the user chooses to sign in");
  assert.equal(app.requests.length, 0, "no account, no network");

  assert.deepEqual(await app.open().signIn(), user);
  assert.deepEqual(app.requests, [jwksUrl], "verified against the client's own published keys, with no identity server");

  const restarted = await app.open().status();
  assert.deepEqual(restarted, user);
  assert.deepEqual(Object.keys(restarted ?? {}).sort(), ["email", "id"], "no token crosses into feedback");

  await app.open().signOut();
  assert.equal(app.signedIn(), undefined);
  assert.equal(await app.open().status(), null);
});

test("2.3 unprotected storage refuses sign-in and reads no token; a token or account that does not verify signs the desktop out", async () => {
  const exposed = desktop(false);
  await assert.rejects(exposed.open().signIn(), /cannot protect/i);
  assert.equal(await exposed.open().status(), null);
  assert.equal(exposed.reads(), 0, "no saved token is read");
  assert.equal(exposed.requests.length, 0);

  const refusals: Array<() => Promise<{ accessToken: string; user: typeof account }>> = [
    async () => ({ accessToken: await token({}, strangerKey), user: account }),
    async () => ({ accessToken: await token({ aud: "someone-else" }), user: account }),
    async () => ({ accessToken: await token({ client_id: "client_01OTHER" }), user: account }),
    async () => ({ accessToken: await token(), user: { ...account, id: "user_01SOMEONEELSE" } }),
    async () => ({ accessToken: await token(), user: { ...account, emailVerified: false } }),
    async () => ({ accessToken: "not-a-token", user: account }),
  ];
  for (const refusal of refusals) {
    const app = desktop();
    app.signInAs(refusal);
    await assert.rejects(app.open().signIn(), /could not be verified/i);
    assert.equal(app.signedIn(), undefined, "a refused sign-in keeps no session");
  }

  const app = desktop();
  await app.open().signIn();
  app.keyAnswers.push(new Response("down", { status: 503 }));
  await assert.rejects(app.open().status(), /temporarily unavailable/i);
  assert.notEqual(app.signedIn(), undefined, "keys that could not be fetched keep the session");
});

/** Stands in for the official SDK's main-process session manager. */
function fakeEngine(): SignInEngine & { calls: string[]; token: string | null; failExchange: boolean } {
  const engine = {
    calls: [] as string[],
    token: null as string | null,
    failExchange: false,
    beginSignIn: async () => { engine.calls.push("begin"); },
    completeCallback: async (code: string, state: string | undefined) => {
      engine.calls.push(`complete ${code} ${state}`);
      if (engine.failExchange) throw new Error("exchange refused");
      engine.token = "access-token";
    },
    getUser: async () => engine.token === null ? { user: null } : { user: account, accessToken: engine.token },
    signOut: async () => { engine.calls.push("sign-out"); engine.token = null; },
  };
  return engine;
}

test("2.5 desktop sign-in is offered only with a public WorkOS client ID, and needs no identity server", () => {
  assert.deepEqual(feedbackIdentityConfig("client_01ABC"), { clientId: "client_01ABC" });
  assert.equal(feedbackIdentityConfig(undefined), undefined);
  assert.equal(feedbackIdentityConfig(""), undefined);
  assert.equal(feedbackIdentityConfig("sk_live_secret"), undefined);
});

test("2.5 a desktop sign-in waits for the storytree-auth callback and completes on it; the token stays with the session", async () => {
  const engine = fakeEngine();
  const session = callbackSession(engine, () => true);
  let settled = false;
  const signingIn = session.signIn().then(() => { settled = true; });
  const again = session.signIn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, "pending until the browser comes back");
  assert.deepEqual(engine.calls, ["begin"], "a second sign-in while one is pending joins it");
  await session.callback("storytree-auth://callback?code=abc&state=xyz");
  await signingIn;
  await again;
  assert.deepEqual(engine.calls, ["begin", "complete abc xyz"]);
  assert.equal((await session.current())?.accessToken, "access-token");
});

test("2.5 a refused or failed callback refuses the desktop sign-in, and a stray link is ignored", async () => {
  const engine = fakeEngine();
  const session = callbackSession(engine, () => true);
  const refused = session.signIn();
  await session.callback("https://example.com/?code=nope");
  await session.callback("storytree-auth://elsewhere?code=nope");
  await session.callback("storytree-auth://callback?error=access_denied&error_description=User%20cancelled");
  await assert.rejects(refused, /refused: User cancelled/);
  assert.deepEqual(engine.calls, ["begin"]);

  engine.failExchange = true;
  const failed = session.signIn();
  await session.callback("storytree-auth://callback?code=bad&state=s");
  await assert.rejects(failed, /could not be completed: exchange refused/);
  assert.equal(await session.current(), undefined);
});

test("2.5 a desktop sign-in the browser never returns from is given up; sign-out ends a pending one and the session", async () => {
  const engine = fakeEngine();
  await assert.rejects(callbackSession(engine, () => true, 5).signIn(), /did not come back/);

  const session = callbackSession(engine, () => true);
  const pending = session.signIn();
  await session.signOut();
  await assert.rejects(pending, /Signed out/);
  assert.ok(engine.calls.includes("sign-out"));
});

test("2.5 a callback that started the desktop is completed with no sign-in waiting, and is found among its arguments", async () => {
  assert.deepEqual(callbackUrls(["electron.exe", ".", "--background", "storytree-auth://callback?code=c&state=s"]), ["storytree-auth://callback?code=c&state=s"]);
  assert.deepEqual(callbackUrls(["electron.exe", "--quit"]), []);
  const engine = fakeEngine();
  const session = callbackSession(engine, () => false);
  await session.callback("storytree-auth://callback?code=c&state=s");
  assert.equal((await session.current())?.accessToken, "access-token");
  assert.equal(session.storageProtected(), false);
});

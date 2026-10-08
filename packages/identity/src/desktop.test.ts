import assert from "node:assert/strict";
import { test } from "node:test";
import { callbackSession, callbackUrls, createFeedbackIdentity, feedbackIdentityConfig, type DesktopSession, type SignInEngine } from "./desktop.js";

const identityUrl = "https://identity.example.test/v1/identity";
const user = { id: "76c80829-6cfd-4f1e-95e8-9a9c781529ce", email: "first@example.test" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** Stands in for the official desktop SDK: it owns PKCE, the deep link and protected token storage. */
function desktop(protectedStorage = true) {
  let token: string | undefined;
  const requests: { url: string; authorization: string | null }[] = [];
  const answers: Response[] = [];
  const session: DesktopSession = {
    storageProtected: () => protectedStorage,
    async accessToken() { return token; },
    async signIn() { token = "access-private"; },
    async signOut() { token = undefined; },
  };
  const open = () => createFeedbackIdentity({ identityUrl, session,
    fetch: async (input, init) => {
      requests.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization") });
      assert.equal(init?.redirect, "error");
      return answers.shift() ?? response({ error: "unexpected_request" }, 500);
    },
  });
  return { open, answers, requests, token: () => token };
}

test("2.3 a restarted desktop restores its verified account for feedback with only id and email, and sign-out leaves status signed out", async () => {
  const app = desktop();
  assert.equal(await app.open().status(), null, "signed out until the user chooses to sign in");
  assert.equal(app.requests.length, 0, "no account, no network");

  app.answers.push(response({ ...user, provider: "github", subject: "private" }));
  assert.deepEqual(await app.open().signIn(), user);
  assert.deepEqual(app.requests, [{ url: identityUrl, authorization: "Bearer access-private" }]);

  app.answers.push(response(user));
  const restarted = await app.open().status();
  assert.deepEqual(restarted, user);
  assert.deepEqual(Object.keys(restarted ?? {}).sort(), ["email", "id"], "no token crosses into feedback");

  await app.open().signOut();
  assert.equal(app.token(), undefined);
  assert.equal(await app.open().status(), null);
});

test("2.3 unprotected storage refuses sign-in and reads no token; a refused identity signs the desktop out", async () => {
  const exposed = desktop(false);
  await assert.rejects(exposed.open().signIn(), /cannot protect/i);
  assert.equal(exposed.token(), undefined);
  assert.equal(await exposed.open().status(), null);
  assert.equal(exposed.requests.length, 0);

  const app = desktop();
  app.answers.push(response({ error: "revoked" }, 401));
  await assert.rejects(app.open().signIn(), /could not be verified/i);
  assert.equal(app.token(), undefined, "a refused sign-in keeps no session");

  app.answers.push(response(user));
  await app.open().signIn();
  app.answers.push(response({ error: "down" }, 503));
  await assert.rejects(app.open().status(), /temporarily unavailable/i);
  assert.equal(app.token(), "access-private", "a temporary failure keeps the session");
  app.answers.push(response({ id: "not-a-user", email: "x" }));
  assert.equal(await app.open().status(), null);
  assert.equal(app.token(), undefined, "a malformed identity never claims signed in");
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
    getAccessToken: async () => engine.token,
    signOut: async () => { engine.calls.push("sign-out"); engine.token = null; },
  };
  return engine;
}

test("2.5 desktop sign-in is offered only with a public client ID and an explicit HTTPS identity endpoint", () => {
  assert.deepEqual(feedbackIdentityConfig("client_01ABC", "https://identity.example/me"), { clientId: "client_01ABC", identityUrl: "https://identity.example/me" });
  assert.equal(feedbackIdentityConfig(undefined, undefined), undefined);
  assert.equal(feedbackIdentityConfig("client_01ABC", undefined), undefined);
  assert.equal(feedbackIdentityConfig(undefined, "https://identity.example/me"), undefined);
  assert.equal(feedbackIdentityConfig("", "https://identity.example/me"), undefined);
  assert.equal(feedbackIdentityConfig("sk_live_secret", "https://identity.example/me"), undefined);
  assert.equal(feedbackIdentityConfig("client_01ABC", "http://identity.example/me"), undefined);
  assert.equal(feedbackIdentityConfig("client_01ABC", "not a url"), undefined);
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
  assert.equal(await session.accessToken(), "access-token");
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
  assert.equal(await session.accessToken(), undefined);
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
  assert.equal(await session.accessToken(), "access-token");
  assert.equal(session.storageProtected(), false);
});

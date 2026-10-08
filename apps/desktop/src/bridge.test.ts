import assert from "node:assert/strict";
import test from "node:test";

import { createBridge, CHANNELS } from "./bridge.js";

test("app setup 5.6: without sign-in configured the page's bridge has no feedback sign-in; with it, only status, sign-in and sign-out, answered by the main process", async () => {
  const invoked: string[] = [];
  const invoke = async (channel: string) => { invoked.push(channel); return channel === CHANNELS.feedbackIdentityStatus ? { id: "user_1", email: "a@example.com" } : undefined; };
  assert.equal("feedbackIdentity" in createBridge(invoke), false);
  assert.equal("feedbackIdentity" in createBridge(invoke, { feedbackIdentity: false }), false);
  const offered = createBridge(invoke, { feedbackIdentity: true }).feedbackIdentity;
  assert.ok(offered);
  assert.deepEqual(Object.keys(offered).sort(), ["signIn", "signOut", "status"]);
  assert.deepEqual(await offered.status(), { id: "user_1", email: "a@example.com" });
  await offered.signIn();
  await offered.signOut();
  assert.deepEqual(invoked, [CHANNELS.feedbackIdentityStatus, CHANNELS.feedbackIdentitySignIn, CHANNELS.feedbackIdentitySignOut]);
});

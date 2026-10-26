import assert from "node:assert/strict";
import test from "node:test";

import { FEEDBACK_IDENTITY_CHANNELS } from "@storytree/app-setup/bridge";

import { createBridge } from "./bridge.js";

test("app setup 5.6: without sign-in configured the page's bridge has no feedback sign-in; with it, only status, sign-in and sign-out, answered by the main process", async () => {
  const invoked: string[] = [];
  const invoke = async (channel: string) => { invoked.push(channel); return channel === FEEDBACK_IDENTITY_CHANNELS.status ? { id: "user_1", email: "a@example.com" } : undefined; };
  assert.equal("feedbackIdentity" in createBridge(invoke), false);
  assert.equal("feedbackIdentity" in createBridge(invoke, { feedbackIdentity: false }), false);
  const offered = createBridge(invoke, { feedbackIdentity: true }).feedbackIdentity;
  assert.ok(offered);
  assert.deepEqual(Object.keys(offered).sort(), ["signIn", "signOut", "status"]);
  assert.deepEqual(await offered.status(), { id: "user_1", email: "a@example.com" });
  await offered.signIn();
  await offered.signOut();
  assert.deepEqual(invoked, [FEEDBACK_IDENTITY_CHANNELS.status, FEEDBACK_IDENTITY_CHANNELS.signIn, FEEDBACK_IDENTITY_CHANNELS.signOut]);
});

test("1.38 a main-side failure reaches the page in its own words: a call whose main-process handler throws rejects with that error's message and name, without Electron's wrapper", async () => {
  // Electron's ipcRenderer.invoke rejects this way when the main side's handler throws.
  const invoke = async (channel: string) => {
    if (channel === "storytree:start-mark") throw new Error(`Error invoking remote method '${channel}': ${String(new TypeError("Bad mark."))}`);
    throw new Error(`Error invoking remote method '${channel}': ${String(new Error("Only the installed app can open at sign-in."))}`);
  };
  const bridge = createBridge(invoke);
  await assert.rejects(bridge.setSignIn(true), (error: Error) => error.name === "Error" && error.message === "Only the installed app can open at sign-in.");
  await assert.rejects(bridge.startMark("shown"), (error: Error) => error.name === "TypeError" && error.message === "Bad mark.");
  const other = new Error("The window closed.");
  await assert.rejects(createBridge(async () => { throw other; }).readSignIn(), (error) => error === other);
});

import assert from "node:assert/strict";
import test from "node:test";

import { SETTINGS_CHANNELS } from "@storytree/agent-link/view";
import { LIFECYCLE_CHANNELS } from "@storytree/app/lifecycle/bridge";
import { PROJECTS_CHANNELS } from "@storytree/app/projects/bridge";
import { UPDATES_CHANNELS } from "@storytree/app/updates/bridge";
import { SURFACES_CHANNELS } from "@storytree/app/surfaces";
import { FEEDBACK_IDENTITY_CHANNELS, SETUP_HELP_CHANNELS } from "@storytree/app-setup/bridge";
import { JOURNEY_CHANNELS } from "@storytree/journey-events/bridge";

import { createBridge } from "./bridge.js";
import { answerPage } from "./page-operations.js";

test("1.16 a page operation a story declares reaches that story's answer in the main process, with the page's arguments", async () => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipc = { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, listener); } };
  const heard: unknown[][] = [];
  const answer = (name: string) => async (...args: unknown[]) => { heard.push([name, ...args]); return `${name} answered`; };
  answerPage(ipc, JOURNEY_CHANNELS, { readJourney: answer("readJourney"), chooseJourney: answer("chooseJourney"), prepareJourneyDeletion: answer("prepareJourneyDeletion") });
  answerPage(ipc, SETTINGS_CHANNELS, { readSettings: answer("readSettings"), saveSetting: answer("saveSetting") });
  answerPage(ipc, SURFACES_CHANNELS, { readSurfaces: answer("readSurfaces"), saveSurface: answer("saveSurface") });

  const page = createBridge(async (channel, ...args) => handlers.get(channel)!({}, ...args)) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  assert.equal(await page.chooseJourney!(true), "chooseJourney answered");
  assert.equal(await page.saveSetting!("idle-after", ["30m"]), "saveSetting answered");
  assert.equal(await page.saveSurface!(["arcs", "off"]), "saveSurface answered");
  assert.equal(await page.readJourney!(), "readJourney answered");
  assert.deepEqual(heard, [["chooseJourney", true], ["saveSetting", "idle-after", ["30m"]], ["saveSurface", ["arcs", "off"]], ["readJourney"]]);
});

test("1.16 the app's own operations and the setup help's travel on the channels their stories declare, and reach those answers", async () => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipc = { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, listener); } };
  const heard: unknown[][] = [];
  const answers = <Channels extends Record<string, string>>(channels: Channels) =>
    Object.fromEntries(Object.keys(channels).map((name) => [name, async (...args: unknown[]) => { heard.push([name, ...args]); return `${name} answered`; }])) as { [Method in keyof Channels]: (...args: unknown[]) => Promise<string> };
  for (const channels of [UPDATES_CHANNELS, LIFECYCLE_CHANNELS, PROJECTS_CHANNELS, SETUP_HELP_CHANNELS, FEEDBACK_IDENTITY_CHANNELS]) answerPage(ipc, channels, answers(channels));

  const page = createBridge(async (channel, ...args) => handlers.get(channel)!({}, ...args), { feedbackIdentity: true });
  assert.equal(await page.checkForUpdates("check"), "checkForUpdates answered");
  assert.equal(await page.setSignIn(false), "setSignIn answered");
  assert.equal(await page.setInstallChoice("on quit" as never), "setInstallChoice answered");
  assert.equal(await page.chooseProject("tree"), "chooseProject answered");
  assert.equal(await page.deleteProject("tree", "tree", true), "deleteProject answered");
  assert.equal(await page.copyHelpText("words"), "copyHelpText answered");
  assert.equal(await page.feedbackIdentity!.signOut(), "signOut answered");
  assert.deepEqual(heard, [["checkForUpdates", "check"], ["setSignIn", false], ["setInstallChoice", "on quit"], ["chooseProject", "tree"], ["deleteProject", "tree", "tree", true], ["copyHelpText", "words"], ["signOut"]]);
});

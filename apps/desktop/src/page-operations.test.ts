import assert from "node:assert/strict";
import test from "node:test";

import { SETTINGS_CHANNELS } from "@storytree/project-and-caller/view";
import { LIFECYCLE_CHANNELS } from "@storytree/app/lifecycle/bridge";
import { PROJECTS_CHANNELS } from "@storytree/app/projects/bridge";
import { UPDATES_CHANNELS } from "@storytree/app/updates/bridge";
import { PAGE_READS_CHANNELS, SURFACES_CHANNELS } from "@storytree/app/surfaces";
import { FEEDBACK_IDENTITY_CHANNELS, SETUP_HELP_CHANNELS } from "@storytree/app-setup/bridge";
import { FOREST_CHANNELS } from "@storytree/forest/page";
import { JOURNEY_CHANNELS } from "@storytree/app-setup/journey-events/bridge";

import { createBridge } from "./bridge.js";
import { ConnectionError, LIBRARY_UNREACHABLE } from "@storytree/library/connection-error";

import { answerPage, sayOutagesOnce } from "./page-operations.js";

test("1.16 a page operation a story declares reaches that story's answer in the main process, with the page's arguments", async () => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipc = { handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, listener); } };
  const heard: unknown[][] = [];
  const answer = (name: string) => async (...args: unknown[]) => { heard.push([name, ...args]); return `${name} answered`; };
  answerPage(ipc, JOURNEY_CHANNELS, { readJourney: answer("readJourney"), chooseJourney: answer("chooseJourney"), prepareJourneyDeletion: answer("prepareJourneyDeletion") });
  answerPage(ipc, SETTINGS_CHANNELS, { readSettings: answer("readSettings"), saveSetting: answer("saveSetting") });
  answerPage(ipc, SURFACES_CHANNELS, { readSurfaces: answer("readSurfaces"), saveSurface: answer("saveSurface") });
  answerPage(ipc, PAGE_READS_CHANNELS, Object.fromEntries(Object.keys(PAGE_READS_CHANNELS).map((method) => [method, answer(method)])) as Record<keyof typeof PAGE_READS_CHANNELS, ReturnType<typeof answer>>);
  answerPage(ipc, FOREST_CHANNELS, { codeSurvey: answer("codeSurvey") });

  const page = createBridge(async (channel, ...args) => handlers.get(channel)!({}, ...args)) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  assert.equal(await page.chooseJourney!(true), "chooseJourney answered");
  assert.equal(await page.saveSetting!("idle-after", ["30m"]), "saveSetting answered");
  assert.equal(await page.saveSurface!(["arcs", "off"]), "saveSurface answered");
  assert.equal(await page.readJourney!(), "readJourney answered");
  assert.equal(await page.windowReadings!("storytree", ["s1", "s2"]), "windowReadings answered");
  assert.equal(await page.codeSurvey!("storytree"), "codeSurvey answered");
  assert.deepEqual(heard, [["chooseJourney", true], ["saveSetting", "idle-after", ["30m"]], ["saveSurface", ["arcs", "off"]], ["readJourney"], ["windowReadings", "storytree", ["s1", "s2"]], ["codeSurvey", "storytree"]]);
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

test("1.40 · an unreachable library is said once per outage: its reads resolve, so no handler stack is logged, app.log gets one line as it starts and one as it ends, and the page is told it in plain words; any other failure still rejects", async () => {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const logged: string[] = [];
  const page = sayOutagesOnce({ handle: (channel, listener) => { handlers.set(channel, listener); } }, (line) => logged.push(line));
  let reachable = false;
  const refusal = () => new ConnectionError("unreachable", "Storytree could not reach the library at postgres://box:5432/.");
  const read = async () => { if (!reachable) throw refusal(); return "news"; };
  answerPage(page, PAGE_READS_CHANNELS, Object.fromEntries(Object.keys(PAGE_READS_CHANNELS).map((method) => [method, method === "projectTree" ? async () => { throw new Error("tree broken"); } : read])) as Record<keyof typeof PAGE_READS_CHANNELS, () => Promise<string>>);
  answerPage(page, SETTINGS_CHANNELS, { readSettings: async () => "settings", saveSetting: async () => undefined });

  const asked = (channel: string) => handlers.get(channel)!({});
  for (let poll = 0; poll < 5; poll++) {
    await assert.doesNotReject(Promise.resolve(asked(PAGE_READS_CHANNELS.changesSince)), "resolved, so Electron logs no stack");
    await asked(PAGE_READS_CHANNELS.linesSince);
  }
  assert.equal(await asked(SETTINGS_CHANNELS.readSettings), "settings");
  assert.equal(logged.length, 1, "one line as the outage starts, none per poll, and none ended by a read that needs no library");
  assert.match(logged[0]!, /library cannot be reached/i);
  await assert.rejects(Promise.resolve(asked(PAGE_READS_CHANNELS.projectTree)), /tree broken/, "a failure that is not an outage rejects in full");

  const bridge = createBridge(async (channel, ...args) => handlers.get(channel)!({}, ...args)) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  await assert.rejects(bridge.changesSince!("storytree", 0), (error: Error) => error.message.startsWith(LIBRARY_UNREACHABLE), "the page reads the outage in the library's fixed words");

  reachable = true;
  assert.equal(await asked(PAGE_READS_CHANNELS.changesSince), "news");
  assert.equal(await asked(PAGE_READS_CHANNELS.linesSince), "news");
  assert.equal(logged.length, 2, "one line as it ends");
  assert.match(logged[1]!, /answers again/i);
});

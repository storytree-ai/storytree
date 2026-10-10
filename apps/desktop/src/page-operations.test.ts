import assert from "node:assert/strict";
import test from "node:test";

import { SETTINGS_CHANNELS } from "@storytree/agent-link/view";
import { PAGE_READS_CHANNELS, SURFACES_CHANNELS } from "@storytree/app/surfaces";
import { FOREST_CHANNELS } from "@storytree/forest/page";
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

import assert from "node:assert/strict";
import { test } from "node:test";
import type { DoorWords } from "@storytree/library/verbs";

import type { JourneyBridge, JourneyState } from "./bridge.js";
import { JOURNEY_FAMILIES, type JourneyPlace } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("3.3 the journey events story declares the `journey` family the command line mounts, 26th in its list: status, on, off and delete-request act on the runtime the door hands them", async () => {
  const calls: string[] = [];
  let consent: JourneyState["consent"] = "pending";
  const state = (): JourneyState => ({ consent, available: true, installId: "install-test", queued: 0, retention: "30 days" });
  const runtime: JourneyBridge = {
    readJourney: async () => { calls.push("read"); return state(); },
    chooseJourney: async (on) => { calls.push(on ? "on" : "off"); consent = on ? "on" : "off"; return state(); },
    prepareJourneyDeletion: async () => { calls.push("delete"); return { installId: "install-test", contact: "privacy@example.test" }; },
  };
  const place: JourneyPlace = { folder: "/nowhere", journey: async () => runtime };

  const [journey] = JOURNEY_FAMILIES;
  assert.equal(journey!.order, 26);
  assert.deepEqual(journey!.verbs.map((one) => "family" in one.command ? one.command.name : undefined), ["status", "on", "off", "delete-request"]);
  assert.ok(journey!.verbs.every((one) => one.callerless));
  const texts = [];
  for (const one of journey!.verbs) texts.push((await one.act({}, place, WORDS)).text);
  assert.deepEqual(calls, ["read", "on", "off", "delete"]);
  assert.deepEqual(texts.slice(0, 3).map((text) => text.split(".")[0]), ["Journey sharing: not chosen (off)", "Journey sharing: on", "Journey sharing: off"]);
  assert.match(texts[3]!, /Installation ID: install-test\nAsk privacy@example\.test/);
});

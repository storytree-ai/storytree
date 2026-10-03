import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { Window } from "happy-dom";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openJourney } from "./index.js";
import type { JourneyBridge, JourneyState } from "./bridge.js";
import { mountJourneyConsent, mountJourneySettings } from "./view.js";

function setup(consent: JourneyState["consent"] = "pending", available = false) {
  const window = new Window();
  const host = window.document.createElement("div");
  window.document.body.append(host);
  let state: JourneyState = { consent, available, installId: "install-test", queued: consent === "on" ? 2 : 0, ...(available ? { retention: "30 days", deletionContact: "privacy@example.test" } : {}) };
  const choices: boolean[] = [];
  const bridge: JourneyBridge = {
    async readJourney() { return state; },
    async chooseJourney(on) { choices.push(on); state = { ...state, consent: on ? "on" : "off", queued: on ? state.queued : 0 }; return state; },
    async prepareJourneyDeletion() { await bridge.chooseJourney(false); return { installId: state.installId, ...(state.deletionContact === undefined ? {} : { contact: state.deletionContact }) }; },
  };
  return { host, bridge, choices, state: () => state, element: host as unknown as HTMLElement };
}

test("3.1 first launch has no preselected consent, disables unavailable sharing and persists decline", async () => {
  const s = setup();
  const mounted = mountJourneyConsent(s.element, s.bridge);
  await setImmediate();
  assert.equal(s.element.querySelector<HTMLButtonElement>('[data-journey-on]')!.disabled, true);
  assert.equal(s.element.querySelector('[checked]'), null);
  assert.equal(s.element.querySelector<HTMLElement>('[data-journey-status]')!.textContent?.includes("unavailable"), true);
  assert.deepEqual(s.choices, []);
  s.element.querySelector<HTMLButtonElement>('[data-journey-off]')!.click();
  await setImmediate();
  assert.deepEqual(s.choices, [false]);
  assert.equal(s.state().consent, "off");
  assert.equal(s.element.querySelector<HTMLElement>('.journey-panel')!.hidden, true);
  mounted.stop();
});

test("3.1 available first launch shares only after an explicit choice; settled consent does not prompt", async () => {
  const s = setup("pending", true);
  const mounted = mountJourneyConsent(s.element, s.bridge);
  await setImmediate();
  assert.deepEqual(s.choices, []);
  s.element.querySelector<HTMLButtonElement>('[data-journey-on]')!.click();
  await setImmediate();
  assert.equal(s.state().consent, "on");
  mounted.stop();
  const next = mountJourneyConsent(s.element, s.bridge);
  await setImmediate();
  assert.equal(s.element.querySelector<HTMLElement>('.journey-panel')!.hidden, true);
  next.stop();
});

test("3.2 settings acknowledge off only after the bridge persists it, retain off and report errors", async () => {
  const s = setup("on", true);
  let finish!: (state: JourneyState) => void;
  const save = s.bridge.chooseJourney;
  s.bridge.chooseJourney = () => new Promise(resolve => { finish = resolve; });
  const mounted = mountJourneySettings(s.element, s.bridge);
  mounted.open();
  await setImmediate();
  const status = s.element.querySelector<HTMLElement>('[data-journey-status]')!;
  s.element.querySelector<HTMLButtonElement>('[data-journey-off]')!.click();
  assert.match(status.textContent!, /Sharing is on/);
  finish(await save(false));
  await setImmediate();
  assert.match(status.textContent!, /Sharing is off/);
  assert.equal(s.state().queued, 0);
  mounted.close(); mounted.open();
  await setImmediate();
  assert.match(status.textContent!, /Sharing is off/);
  s.bridge.chooseJourney = async () => { throw new Error("storage unavailable"); };
  s.element.querySelector<HTMLButtonElement>('[data-journey-on]')!.click();
  await setImmediate();
  assert.match(status.textContent!, /Sharing is off/);
  assert.match(s.element.querySelector('[role=alert]')!.textContent!, /could not be saved/);
  mounted.stop();
});

test("4.1 deletion prepares contact and installation ID after turning off, without claiming deletion", async () => {
  const s = setup("on", true);
  const mounted = mountJourneySettings(s.element, s.bridge);
  mounted.open(); await setImmediate();
  s.element.querySelector<HTMLButtonElement>('[data-journey-delete]')!.click();
  await setImmediate();
  assert.equal(s.state().consent, "off");
  assert.equal(s.state().queued, 0);
  const instructions = s.element.querySelector('[data-journey-deletion]')!.textContent!;
  assert.match(instructions, /privacy@example.test/);
  assert.match(instructions, /install-test/);
  assert.match(instructions, /has not been sent/);
  s.element.querySelector<HTMLButtonElement>('[data-journey-on]')!.click();
  await setImmediate();
  assert.equal(s.element.querySelector<HTMLElement>('[data-journey-deletion]')!.hidden, true, "old deletion instructions must not describe the new sharing state");
  mounted.stop();
});


test("3.1–3.2 actual controls persist consent and clear queued events across reopened stores", async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), "journey-controls-"));
  const options = { home, appVersion: "0.3.42", configuration: { projectKey: "phc_test_only", retention: "30 days", deletionContact: "privacy@example.test" } };
  const journey = openJourney(options);
  const reopened = openJourney(options);
  const window = new Window();
  const host = window.document.createElement("div") as unknown as HTMLElement;
  const bridge: JourneyBridge = { async readJourney() { return journey.state(); }, async chooseJourney(on) { return journey.choose(on); }, async prepareJourneyDeletion() { return journey.prepareDeletion(); } };
  const prompt = mountJourneyConsent(host, bridge);
  const settingsHost = window.document.createElement("div") as unknown as HTMLElement;
  const settings = mountJourneySettings(settingsHost, bridge);
  t.after(() => { prompt.stop(); settings.stop(); journey.close(); reopened.close(); rmSync(home, { recursive: true, force: true }); });
  await setImmediate();
  host.querySelector<HTMLButtonElement>("[data-journey-on]")!.click();
  await setImmediate();
  assert.equal(reopened.state().consent, "on");
  journey.record("error");
  settings.open(); await setImmediate();
  settingsHost.querySelector<HTMLButtonElement>("[data-journey-off]")!.click();
  await setImmediate();
  assert.equal(reopened.state().consent, "off");
  assert.equal(reopened.state().queued, 0);
});

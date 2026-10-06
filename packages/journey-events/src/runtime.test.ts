import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createJourneyRuntime, journeyBuildDefine, releaseConfiguration } from "./runtime.js";

test("3.1 first-launch consent records current launch milestones only after an explicit yes, and shutdown awaits delivery", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "journey-runtime-"));
  const events: string[] = [];
  let closed = false;
  const runtime = createJourneyRuntime({ home, appVersion: "0.3.42", configuration: {
    projectKey: "phc_test", retention: "30 days", deletionContact: "privacy@example.test",
  }, transport: { send: async event => { events.push(event.event); }, close: async () => { closed = true; } } });
  try {
    runtime.desktopStarted(true);
    assert.equal((await runtime.readJourney()).queued, 0);
    await runtime.chooseJourney(true);
    await runtime.finish();
    assert.deepEqual(events, ["installed", "first_launch", "app_version"]);
    assert.equal(closed, true);
    await runtime.finish();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("2.3 optional observation cannot prevent application cleanup when local storage is unavailable", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "journey-runtime-"));
  const runtime = createJourneyRuntime({ home, appVersion: "0.3.42" });
  try {
    await runtime.readJourney();
    const broken = new DatabaseSync(path.join(home, "journey-events.sqlite"));
    broken.exec("DROP TABLE consent"); broken.close();
    assert.doesNotThrow(() => runtime.desktopStarted(false));
    await assert.rejects(runtime.readJourney());
    await runtime.flush();
    await runtime.finish();
  } finally { await runtime.finish(); rmSync(home, { recursive: true, force: true }); }
});

test("3.1 shipped runtime stays unavailable until the owner activation configuration is supplied", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "journey-runtime-"));
  const runtime = createJourneyRuntime({ home, appVersion: "0.3.42" });
  try {
    assert.equal((await runtime.readJourney()).available, false);
    await assert.rejects(runtime.chooseJourney(true), /not available/i);
    runtime.record("error");
    assert.equal((await runtime.readJourney()).queued, 0);
  } finally { await runtime.finish(); rmSync(home, { recursive: true, force: true }); }
});

test("1.4 only completed current actions produce project and landing milestones", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "journey-runtime-"));
  const events: string[] = [];
  const runtime = createJourneyRuntime({ home, appVersion: "0.3.42", configuration: {
    projectKey: "phc_test", retention: "30 days", deletionContact: "privacy@example.test",
  }, transport: { send: async event => { events.push(event.event); }, close: async () => {} } });
  try {
    runtime.projectCreated(); runtime.incrementClosed("landed");
    await runtime.chooseJourney(true);
    runtime.afterProjectAdded(null); runtime.afterProjectAdded({ status: "already a project" });
    runtime.incrementClosed("withdrawn"); runtime.incrementClosed("failed");
    assert.equal((await runtime.readJourney()).queued, 0);
    const result = { status: "set up", project: "private project name" };
    assert.equal(runtime.afterProjectAdded(result), result);
    runtime.incrementClosed("landed");
    await runtime.finish();
    assert.deepEqual(events, ["first_project", "first_landed_increment"]);
  } finally { await runtime.finish(); rmSync(home, { recursive: true, force: true }); }
});

test("3.1 a build stamps in only the public project token, refusing a private key, and that token makes sharing available", async () => {
  assert.deepEqual(journeyBuildDefine({}), {});
  assert.deepEqual(journeyBuildDefine({ STORYTREE_JOURNEY_KEY: "phc_public" }), { STORYTREE_JOURNEY_KEY: '"phc_public"' });
  assert.throws(() => journeyBuildDefine({ STORYTREE_JOURNEY_KEY: "phx_private" }), /public project token/);
  assert.equal(releaseConfiguration("phx_private"), undefined);
  const home = mkdtempSync(path.join(tmpdir(), "journey-runtime-"));
  const runtime = createJourneyRuntime({ home, appVersion: "0.3.42", configuration: releaseConfiguration("phc_public")! });
  try {
    const state = await runtime.readJourney();
    assert.equal(state.available, true);
    assert.match(state.retention!, /1 year/);
    assert.equal(state.deletionContact, "hua.mick@gmail.com");
  } finally { await runtime.finish(); rmSync(home, { recursive: true, force: true }); }
});

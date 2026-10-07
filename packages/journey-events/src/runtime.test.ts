import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createJourneyRuntime, releaseConfiguration } from "./runtime.js";
import { journeyDefine } from "./release.js";
import { createPostHogTransport } from "./posthog.js";

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

test("3.1 a development copy, stamped with no public project token, stays unavailable", async () => {
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

test("2.4 a shipped build is stamped with only the public project token, which makes sharing available with its retention and deletion contact", async () => {
  assert.deepEqual(journeyDefine({}), {});
  assert.equal(releaseConfiguration(undefined), undefined);
  assert.throws(() => journeyDefine({ STORYTREE_JOURNEY_KEY: "phx_private_personal_key" }), /public project token/);
  const stamp = journeyDefine({ STORYTREE_JOURNEY_KEY: " phc_public_token " });
  assert.deepEqual(stamp, { STORYTREE_JOURNEY_KEY: '"phc_public_token"' });
  const home = mkdtempSync(path.join(tmpdir(), "journey-runtime-"));
  const configuration = releaseConfiguration(JSON.parse(stamp.STORYTREE_JOURNEY_KEY!) as string)!;
  const runtime = createJourneyRuntime({ home, appVersion: "0.3.42", configuration });
  try {
    const state = await runtime.readJourney();
    assert.equal(state.available, true);
    assert.equal(state.consent, "pending");
    assert.match(state.retention!, /1 year/);
    assert.equal(state.deletionContact, "hua.mick@gmail.com");
  } finally { await runtime.finish(); rmSync(home, { recursive: true, force: true }); }
});

test("2.3 CLI shutdown awaits a bounded flush: a network that never answers cannot hold the command open, and the milestone stays queued", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "journey-runtime-"));
  const configuration = { projectKey: "phc_test", retention: "30 days", deletionContact: "privacy@example.test" };
  const transport = createPostHogTransport({ projectKey: "phc_test", permitted: () => true, fetch: () => new Promise<Response>(() => {}) });
  const runtime = createJourneyRuntime({ home, appVersion: "0.3.42", configuration, transport });
  const reopened = createJourneyRuntime({ home, appVersion: "0.3.42", configuration });
  try {
    await runtime.chooseJourney(true);
    runtime.projectCreated();
    const started = Date.now();
    await runtime.finish();
    assert.ok(Date.now() - started < 6_000, `shutdown took ${Date.now() - started} ms`);
    assert.equal((await reopened.readJourney()).queued, 1);
  } finally { await runtime.finish(); await reopened.finish(); rmSync(home, { recursive: true, force: true }); }
});

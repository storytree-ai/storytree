import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { openJourney } from "./index.js";

const configuration = { projectKey: "phc_test_only", retention: "30 days", deletionContact: "privacy@example.test" };
function fixture() {
  const home = mkdtempSync(path.join(os.tmpdir(), "storytree-journey-"));
  const opened: ReturnType<typeof openJourney>[] = [];
  const open = (configured = true) => {
    const journey = openJourney({ home, appVersion: "0.3.42", ...(configured ? { configuration } : {}) });
    opened.push(journey);
    return journey;
  };
  return { open, close() { for (const journey of opened) journey.close(); rmSync(home, { recursive: true, force: true }); } };
}

test("1.1 sharing defaults off and persists explicit consent without backfilling earlier milestones", () => {
  const f = fixture();
  try {
    const a = f.open();
    assert.equal(a.state().consent, "pending");
    assert.equal(a.record("first_project"), false);
    a.choose(false);
    assert.equal(f.open().state().consent, "off");
    assert.equal(a.record("first_project"), false);
    a.choose(true);
    assert.equal(f.open().state().consent, "on");
    assert.equal(a.state().queued, 0);
    assert.equal(a.record("first_project"), true);
    assert.equal(a.record("first_project"), false);
    assert.equal(a.state().queued, 1);
  } finally { f.close(); }
});

test("1.2 only named milestones and validated app versions cross the queue boundary", async () => {
  const f = fixture();
  try {
    const a = f.open(); a.choose(true);
    for (const event of ["prompt", "$identify", "__proto__", { name: "error" }]) assert.throws(() => a.record(event));
    for (const fields of [{ code: "secret" }, { message: "private error" }, { app_version: "private" }, null]) assert.throws(() => a.record("error", fields));
    assert.equal(a.state().queued, 0);
    for (const event of ["installed", "first_launch", "agent_connected", "hooks_verified", "first_project", "first_landed_increment", "error", "app_version"]) a.record(event);
    const sent: unknown[] = [];
    await a.flush({ send: async event => { sent.push(event); }, close: async () => {} });
    assert.equal(sent.length, 8);
    for (const event of sent as { properties: unknown; distinctId: string }[]) {
      assert.deepEqual(event.properties, { app_version: "0.3.42" });
      assert.match(event.distinctId, /^[0-9a-f-]{36}$/);
    }
  } finally { f.close(); }
});

test("1.3 the anonymous installation id survives reopening", () => {
  const f = fixture();
  try {
    const a = f.open();
    assert.match(a.state().installId, /^[0-9a-f-]{36}$/);
    assert.equal(f.open().state().installId, a.state().installId);
  } finally { f.close(); }
});

test("2.1 offline events survive reopening and are removed only after accepted delivery", async () => {
  const f = fixture();
  try {
    const a = f.open(); a.choose(true); a.record("first_launch");
    const seen: string[] = [];
    const failed = await a.flush({ send: async event => { seen.push(event.uuid); throw Error("offline"); }, close: async () => {} });
    assert.equal(failed, 0);
    const b = f.open(); assert.equal(b.state().queued, 1);
    assert.equal(await b.flush({ send: async event => { seen.push(event.uuid); }, close: async () => {} }), 1);
    assert.equal(seen[0], seen[1]);
    assert.equal(a.state().queued, 0);
  } finally { f.close(); }
});

test("2.3 another connection switching off drops queued events and stops the next send, even after re-enabling", async () => {
  const f = fixture();
  try {
    const a = f.open(); const b = f.open(); a.choose(true);
    a.record("first_launch"); a.record("first_project");
    let sends = 0;
    await a.flush({ send: async () => { sends++; b.choose(false); b.choose(true); }, close: async () => {} });
    assert.equal(sends, 1);
    assert.equal(a.state().queued, 0);
  } finally { f.close(); }
});

test("3.1 absent service and privacy configuration cannot enable sharing or send queued events", async () => {
  const f = fixture();
  try {
    const disabled = f.open(false);
    assert.equal(disabled.state().available, false);
    assert.throws(() => disabled.choose(true), /not available/i);
    const configured = f.open(); configured.choose(true); configured.record("error");
    let sends = 0;
    await disabled.flush({ send: async () => { sends++; }, close: async () => {} });
    assert.equal(sends, 0);
    assert.equal(disabled.record("error"), false);
  } finally { f.close(); }
});

test("2.1 the offline queue retains at most 500 events and expires events after seven days", async (t) => {
  const f = fixture();
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  try {
    const a = f.open(); a.choose(true);
    for (let i = 0; i < 502; i++) a.record("error");
    assert.equal(a.state().queued, 500);
    now += 7 * 24 * 60 * 60 * 1000 + 1;
    assert.equal(f.open().state().queued, 0);
  } finally { f.close(); }
});

test("4.1 preparing a deletion request switches sharing off and clears local events, without claiming remote erasure", () => {
  const f = fixture();
  try {
    const a = f.open(); a.choose(true); a.record("error");
    const request = a.prepareDeletion();
    assert.equal(request.installId, a.state().installId);
    assert.equal(request.contact, "privacy@example.test");
    assert.equal(a.state().consent, "off");
    assert.equal(a.state().queued, 0);
  } finally { f.close(); }
});

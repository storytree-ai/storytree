import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runPool } from "./launch.mjs";
import { paceOf, readLanePace } from "./pace.mjs";

const now = Date.parse("2026-10-17T10:00:00Z");
const usage = (at, ...rateLimits) => ({ usage: { kind: "usage-measured", at, context: { window: 200_000 }, rateLimits } });
const window = (kind, percentUsed, resetsAt) => ({ kind, percentUsed, ...(resetsAt ? { resetsAt } : {}) });

test("3.20 · the lanes' latest rate-limit reading slows dispatch near a limit and pauses it at the limit until the window resets; no reading, a reset passed or a stale reading holds nothing back", () => {
  assert.equal(paceOf([], { now }), undefined, "no readings: dispatch as before");
  assert.equal(paceOf([usage("2026-10-17T09:59:00Z", window("five_hour", 40, "2026-10-17T12:00:00Z"))], { now }), undefined);

  const slow = paceOf([usage("2026-10-17T09:59:00Z", window("five_hour", 85, "2026-10-17T12:00:00Z"), window("seven_day", 30))], { now });
  assert.equal(slow.hold, "slow");
  assert.match(slow.reason, /five_hour 85% used \(resets 2026-10-17T12:00Z\)/);

  // The latest reading of a window wins, whichever lane reported it.
  const paused = paceOf([
    usage("2026-10-17T09:50:00Z", window("five_hour", 85, "2026-10-17T12:00:00Z")),
    usage("2026-10-17T09:58:00Z", window("five_hour", 97, "2026-10-17T12:00:00Z"), window("seven_day", 96, "2026-10-18T00:00:00Z")),
  ], { now });
  assert.deepEqual([paused.hold, paused.until], ["pause", Date.parse("2026-10-18T00:00:00Z")], "paused until the last full window resets");
  assert.match(paused.reason, /no new lane until 2026-10-18T00:00Z/);
  assert.equal(paceOf([usage("2026-10-17T09:58:00Z", window("five_hour", 97, "2026-10-17T12:00:00Z"))], { now: Date.parse("2026-10-17T12:00:01Z") }), undefined, "the window reset: dispatch resumes");
  assert.equal(paceOf([usage("2026-10-17T08:00:00Z", window("five_hour", 97))], { now }), undefined, "an undated window unread for an hour no longer counts");

  // A turn that failed on a window after its last reading puts it at the limit, until the reset that reading named.
  const failed = { ...usage("2026-10-17T09:00:00Z", window("five_hour", 60, "2026-10-17T12:00:00Z")), failed: { kind: "turn-failed", at: "2026-10-17T09:30:00Z", reason: "error", limits: ["five_hour"] } };
  assert.deepEqual([paceOf([failed], { now }).hold, paceOf([failed], { now }).until], ["pause", Date.parse("2026-10-17T12:00:00Z")]);
});

test("3.20 · the dispatcher holds back on the pace, saying why in its status once per change, and dispatches to the cap again once the limit clears; a failed reading dispatches as before", async () => {
  const lines = [], started = [], ends = [];
  let engines = 0, looks = 0, stop = false;
  const paces = [
    { hold: "pause", windows: ["five_hour"], reason: "Claude's five_hour 97% used: no new lane until 12:00Z" },
    { hold: "pause", windows: ["five_hour"], reason: "Claude's five_hour 98% used: no new lane until 12:00Z" },
    { hold: "slow", windows: ["five_hour"], reason: "Claude's five_hour 85% used: half the cap" },
    undefined,
  ];
  await runPool({
    survey: async () => ({ increments: ["a", "b", "c", "d", "e"].map((id, at) => ({ id, arc: `arc_${id}`, arcState: "active", title: id, body: "", status: "proposal", parked: `2026-10-0${at + 1}T00:00:00Z` })), holds: { waits: {}, heldOn: {} }, claims: [] }),
    pace: async () => paces.shift(),
    maxLanes: async () => 4, count: async () => engines, stopFile: "/lanes/pool-stop", exists: async () => stop, now: () => now, say: (line) => lines.push(line),
    launch: (one, { engineUp }) => { started.push(one.id); engines += 1; engineUp(); return new Promise((done) => ends.push(done)); },
    sleep: async () => {
      looks += 1;
      await new Promise((go) => setImmediate(go));
      if (looks === 2) assert.deepEqual(started, [], "paused: nothing starts");
      if (looks === 3) assert.deepEqual(started, ["a", "b"], "slowed: half the cap of four");
      if (looks === 4) { assert.deepEqual(started, ["a", "b", "c", "d"], "clear: up to the cap again"); stop = true; engines = 0; for (const end of ends) end(0); }
    },
  });
  const said = lines.filter((line) => /holding back|slowing|rate limits/.test(line));
  assert.equal(said.length, 3, "said once per change, not once per look");
  assert.match(said[0], /holding back dispatch: Claude's five_hour 97% used: no new lane until 12:00Z/);
  assert.match(said[1], /slowing dispatch: Claude's five_hour 85% used: half the cap/);
  assert.match(said[2], /rate limits clear: dispatching up to the cap/);

  const failing = [];
  let ran = 0;
  await runPool({
    survey: async () => ({ increments: [{ id: "a", arc: "arc_a", arcState: "active", title: "a", body: "", status: "proposal", parked: "2026-10-01T00:00:00Z" }], holds: { waits: {}, heldOn: {} }, claims: [] }),
    pace: async () => { throw new Error("library down"); },
    maxLanes: async () => 1, count: async () => ran, stopFile: "/lanes/pool-stop", exists: async () => ran > 0, now: () => now, say: (line) => failing.push(line),
    launch: async (one, { engineUp }) => { ran += 1; engineUp(); return 0; }, sleep: async () => {},
  });
  assert.equal(ran, 1, "an unread pace dispatches as before");
  assert.ok(failing.some((line) => /rate-limit readings unread \(library down\)/.test(line)));
});

test("3.20 · the pace reads the newest lanes' reported usage, and only while the next lane would run Claude Code", async (t) => {
  const lanesDir = await mkdtemp(join(tmpdir(), "lane-pace-"));
  t.after(() => rm(lanesDir, { recursive: true, force: true }));
  const full = new Map([["S2", usage("2026-10-17T09:59:00Z", window("five_hour", 99, "2026-10-17T12:00:00Z"))]]);
  const asked = [];
  const usageOf = async (sessions) => { asked.push(sessions); return full; };
  const claude = async () => ({ engine: "claude" });
  assert.equal(await readLanePace({ lanesDir, now: () => now, nextEngine: claude, usageOf }), undefined, "no lane wrote a session id: nothing read");
  assert.deepEqual(asked, []);

  await writeFile(join(lanesDir, "pool-a-1.session"), "S1\n");
  await writeFile(join(lanesDir, "pool-b-2.session"), "S2\n");
  await utimes(join(lanesDir, "pool-a-1.session"), new Date(now - 60_000), new Date(now - 60_000));
  await utimes(join(lanesDir, "pool-b-2.session"), new Date(now), new Date(now));
  assert.equal((await readLanePace({ lanesDir, now: () => now, nextEngine: claude, usageOf })).hold, "pause");
  assert.deepEqual(asked, [["S2", "S1"]], "newest first");
  assert.equal(await readLanePace({ lanesDir, now: () => now, nextEngine: async () => ({ engine: "codex" }), usageOf }), undefined, "a Codex lane is not held back by Claude's windows");
});

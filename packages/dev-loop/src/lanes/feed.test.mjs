import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { keepFed, main, markQueue, parseFences, pickNext, queuedOnTracks, readSurvey, WEBSITE_ARC, writesOf } from "./feed.mjs";

const fences = parseFences(`L=packages/library, packages/librarian, packages/cli
A=packages/agent-link, packages/app, apps/desktop/src/main, packages/dev-loop
S=packages/identity, packages/cli (sign-in commands only), apps/desktop/src/main and apps/desktop packaging config (storytree-auth deep link only)
`);
const hour = 3_600_000;
const now = Date.parse("2026-10-07T03:00:00Z");

function increment(id, body, extra = {}) {
  return { id, arc: "arc_a", arcState: "active", title: id, body, status: "proposal", parked: "2026-10-06T00:00:00Z", ...extra };
}
function survey(increments, extra = {}) {
  return { increments, holds: { waits: {}, heldOn: {} }, claims: [], laptopArcs: [], ...extra };
}

test("11.1 · picks the oldest ready increment whose body names the track or only packages inside its fence", () => {
  assert.deepEqual(parseFences("A=packages/dev-loop, apps/desktop/src/main\n# note\n").A, ["packages/dev-loop", "apps/desktop/src/main"]);
  const work = survey([
    increment("newer", "Build it in packages/dev-loop/src/lanes.", { parked: "2026-10-06T05:00:00Z" }),
    increment("older", "Touches packages/agent-link and apps/desktop/src/main/index.ts.", { parked: "2026-10-05T00:00:00Z" }),
    increment("crosses", "Touches packages/dev-loop and packages/cli.", { parked: "2026-10-01T00:00:00Z" }),
    increment("unplaced", "No package named.", { parked: "2026-10-01T00:00:00Z" }),
    increment("other-track", "Needs: Mint, packages/dev-loop (track L)", { parked: "2026-10-01T00:00:00Z" }),
    increment("packaging", "apps/desktop packaging only.", { parked: "2026-10-01T00:00:00Z" }),
  ]);
  const { pick, skipped } = pickNext(work, { track: "A", fences });
  assert.equal(pick, "older");
  const why = Object.fromEntries(skipped.map((skip) => [skip.id, skip.why]));
  assert.match(why.crosses, /outside track A's fence: packages\/cli/);
  assert.match(why.unplaced, /names no package/);
  assert.match(why["other-track"], /track L/);
  assert.match(why.packaging, /outside track A's fence: apps\/desktop/);
  assert.equal(pickNext(survey([increment("named", "Needs: Mint (track A)")]), { track: "A", fences }).pick, "named");

  const held = survey([
    increment("waits", "packages/dev-loop", { parked: "2026-10-01T00:00:00Z" }),
    increment("question", "packages/dev-loop", { parked: "2026-10-02T00:00:00Z" }),
    increment("claimed", "packages/dev-loop", { parked: "2026-10-03T00:00:00Z" }),
    increment("closed", "packages/dev-loop", { parked: "2026-10-03T00:00:00Z", status: "closed" }),
    increment("parked-arc", "packages/dev-loop", { parked: "2026-10-03T00:00:00Z", arcState: "parked" }),
    increment("idle-claim", "packages/dev-loop", { parked: "2026-10-04T00:00:00Z" }),
  ], {
    holds: { waits: { waits: [{ on: "x", reason: "first" }] }, heldOn: { question: ["question_1"] } },
    claims: [{ increment: "claimed", session: "s1", holder: "live", since: "2026-10-07T00:00:00Z" },
      { increment: "idle-claim", session: "s2", holder: "idle", since: "2026-10-06T00:00:00Z" }],
  });
  const result = pickNext(held, { track: "A", fences });
  assert.equal(result.pick, "idle-claim", "an idle holder can be taken over");
  const reasons = Object.fromEntries(result.skipped.map((skip) => [skip.id, skip.why]));
  assert.match(reasons.waits, /waits on x/);
  assert.match(reasons.question, /held on question_1/);
  assert.match(reasons.claimed, /held by live session s1/);
  assert.equal(reasons.closed, undefined, "closed work is not a candidate at all");
  assert.equal(reasons["parked-arc"], undefined, "a parked arc's work is not a candidate");
});

test("11.2 · skips owner actions, another machine's work, the website arc and arcs a live laptop session touched", () => {
  const work = survey([
    increment("owner", "packages/dev-loop. Needs: the owner's sign-in."),
    increment("owner-action", "packages/dev-loop. An owner action: send the email."),
    increment("laptop", "packages/dev-loop. Needs: the laptop."),
    increment("website", "packages/dev-loop", { arc: WEBSITE_ARC }),
    increment("laptop-arc", "packages/dev-loop", { arc: "arc_busy" }),
    increment("mint", "Needs: Mint, packages/dev-loop (track A)", { parked: "2026-10-06T09:00:00Z" }),
  ], { laptopArcs: ["arc_busy"] });
  const { pick, skipped } = pickNext(work, { track: "A", fences });
  assert.equal(pick, "mint");
  const why = Object.fromEntries(skipped.map((skip) => [skip.id, skip.why]));
  assert.match(why.owner, /owner/);
  assert.match(why["owner-action"], /owner/);
  assert.match(why.laptop, /another machine/);
  assert.match(why.website, /website arc/);
  assert.match(why["laptop-arc"], /live laptop session/);
});

test("11.2 · the survey reads arcs once, and counts as laptop-touched only arcs where a live off-box session seen in the last hour holds an increment, never by touches (ADR-0944 D2)", async () => {
  let reads = 0;
  const record = (id, arc, body, extra = {}) => ({ id, createdAt: new Date(now - hour), fields: { arc, title: id, body, status: "proposal", parked: "2026-10-06T00:00:00Z", waits: [], ...extra } });
  const library = {
    arcViews: async () => {
      reads++;
      return [
        { arc: { id: "arc_laptop" }, state: "active", increments: [record("i1", "arc_laptop", "a"), record("i2", "arc_laptop", "b", { touches: ["capability_x"] })] },
        { arc: { id: "arc_cap" }, state: "active", increments: [record("i3", "arc_cap", "c", { touches: ["capability_x"] })] },
        { arc: { id: "arc_box" }, state: "parked", increments: [record("i4", "arc_box", "d")] },
        { arc: { id: "arc_stale" }, state: "active", increments: [record("i5", "arc_stale", "e")] },
      ];
    },
    holds: async () => ({ waits: { i1: [{ on: "z", reason: "r" }] }, heldOn: {} }),
  };
  const claims = [
    { increment: "i1", session: "laptop", holder: "live", since: "2026-10-07T02:30:00Z" },
    { capability: "capability_x", session: "laptop", holder: "live", since: "2026-10-07T02:30:00Z" },
    { increment: "i4", session: "box", holder: "live", since: "2026-10-07T02:30:00Z" },
    { increment: "i5", session: "old", holder: "live", since: "2026-10-06T00:00:00Z" },
  ];
  let asked;
  const sessions = async (ids) => {
    asked = ids;
    return [
      { session: "laptop", folder: "C:\\Users\\owner\\storytree03", worktrees: ["C:\\Users\\owner\\storytree03"], lastSeenAt: "2026-10-07T02:50:00Z" },
      { session: "box", folder: "/home/mint/code/storytree03", worktrees: ["/home/mint/code/storytree03"], lastSeenAt: "2026-10-07T02:50:00Z" },
      { session: "old", folder: "C:\\Users\\owner\\other", worktrees: [], lastSeenAt: "2026-10-07T01:00:00Z" },
    ];
  };
  const read = await readSurvey({ library, claims: async () => claims, sessions, now, home: "/home/mint" });
  assert.equal(reads, 1);
  assert.deepEqual([...asked].sort(), ["box", "laptop", "old"]);
  assert.deepEqual(read.laptopArcs.sort(), ["arc_laptop"]);
  assert.deepEqual(read.increments.map((one) => [one.id, one.arc, one.arcState, one.body]), [
    ["i1", "arc_laptop", "active", "a"], ["i2", "arc_laptop", "active", "b"], ["i3", "arc_cap", "active", "c"], ["i4", "arc_box", "parked", "d"], ["i5", "arc_stale", "active", "e"]]);
  assert.deepEqual(read.holds.waits.i1, [{ on: "z", reason: "r" }]);
  assert.equal(read.claims, claims);
});

test("11.3 · a refused increment is retried once the refusing claim clears, and one that failed unrefused is not retried", () => {
  const attempts = new Map([["refused", { at: Date.parse("2026-10-07T01:00:00Z") }], ["failed", { at: Date.parse("2026-10-07T01:00:00Z") }],
    ["own", { at: Date.parse("2026-10-07T01:00:00Z") }]]);
  const work = [increment("refused", "packages/dev-loop", { parked: "2026-10-06T09:00:00Z" }), increment("failed", "packages/dev-loop"), increment("own", "packages/dev-loop")];
  const first = pickNext(survey(work, { claims: [
    { increment: "refused", session: "other", holder: "live", since: "2026-10-07T00:00:00Z" },
    { increment: "own", session: "lane", holder: "live", since: "2026-10-07T01:05:00Z" },
  ] }), { track: "A", fences, attempts });
  assert.equal(first.pick, undefined);
  const why = Object.fromEntries(first.skipped.map((skip) => [skip.id, skip.why]));
  assert.match(why.refused, /held by live session other/);
  assert.match(why.failed, /already run/);
  assert.match(why.own, /held by live session lane/);
  for (let look = 0; look < 3; look++) {
    const again = pickNext(survey(work, { claims: [{ increment: "own", session: "lane", holder: "idle", since: "2026-10-07T01:05:00Z" }] }), { track: "A", fences, attempts });
    assert.equal(again.pick, look === 0 ? "refused" : undefined, "the cleared refusal is retried, once");
    if (again.pick) attempts.set(again.pick, { at: Date.parse("2026-10-07T02:00:00Z") });
    assert.match(Object.fromEntries(again.skipped.map((skip) => [skip.id, skip.why])).own, /already run/, "the lane's own lapsed claim is not a refusal");
  }
});

test("11.4 · an empty queue refills from one survey per refill, runs it, and with nothing ready waits and looks again until stopped", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lane-feed-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const queue = join(dir, "night-queue-A.txt"), stop = join(dir, "night-stop");
  await writeFile(queue, "queued\n");
  const ran = [], lines = [];
  let surveys = 0, sleeps = 0;
  const looks = [
    survey([increment("ready", "packages/dev-loop")]),
    survey([increment("ready", "packages/dev-loop", { status: "closed" })]),
    survey([increment("later", "packages/agent-link")]),
    survey([]),
  ];
  const code = await keepFed({
    track: "A", fences, queueFile: queue, stopFile: stop, intervalMs: 900_000, now: () => now, say: (line) => lines.push(line),
    survey: async () => looks[Math.min(surveys++, looks.length - 1)],
    runLane: async (id) => { ran.push(id); assert.equal((await readFile(queue, "utf8")).split("\n")[0], id, "the lane runs from the queue's head"); return 0; },
    sleep: async (ms) => { assert.equal(ms, 900_000); if (++sleeps === 2) await writeFile(stop, ""); },
  });
  assert.equal(code, 0);
  assert.deepEqual(ran, ["queued", "ready", "later"]);
  assert.equal(surveys, 4, "one survey per refill or look");
  assert.equal(sleeps, 2);
  assert.equal((await readFile(queue, "utf8")).trim(), "");
  assert.ok(lines.some((line) => /took ready from the library/.test(line)));
  assert.ok(lines.some((line) => /nothing ready in track A's fence/.test(line)));
  assert.ok(lines.some((line) => /stopped by night-stop/.test(line)));
  assert.ok(existsSync(stop));

  await rm(stop);
  await writeFile(queue, "failing\nnext\n");
  const kept = await keepFed({ track: "A", fences, queueFile: queue, stopFile: stop, now: () => now, say: () => {},
    survey: async () => assert.fail("no survey while the queue holds work"), runLane: async () => 75, sleep: async () => assert.fail("no wait") });
  assert.equal(kept, 75, "an engine failing at once stops the track");
  assert.equal(await readFile(queue, "utf8"), "failing\nnext\n", "and keeps its lane queued");

  await writeFile(queue, "");
  const failed = [];
  assert.equal(await keepFed({ track: "A", fences, queueFile: queue, stopFile: stop, now: () => now, say: (line) => failed.push(line),
    survey: async () => { throw new Error("library unreachable"); }, runLane: () => assert.fail(), sleep: async () => writeFile(stop, "") }), 0);
  assert.match(failed[0], /library survey failed \(library unreachable\); looking again in 15 min/, "a failed survey waits rather than ending the track");
});

test("11.1 · the next front door prints the track's pick and each skip from one survey, refusing a track night-fences.txt lacks", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "lane-next-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, "night-fences.txt"), "A=packages/dev-loop\n");
  const lines = [];
  let surveys = 0;
  const options = { lanesDir: dir, say: (line) => lines.push(line), survey: async () => { surveys++; return survey([increment("in", "packages/dev-loop"), increment("out", "packages/cli", { parked: "2026-10-01T00:00:00Z" })]); } };
  assert.equal(await main(["next", "A"], options), 0);
  assert.deepEqual(lines, ["skip out: outside track A's fence: packages/cli", "next: in"]);
  assert.equal(surveys, 1);
  assert.equal(await main(["next", "Z"], options), 2);
  assert.equal(await main(["run", "A"], options), 2);
});

test("12.6 · beside running lanes a track starts only queued or library work writing other packages; unknown ownership runs alone", async (t) => {
  assert.deepEqual(writesOf("Write ownership: packages/dev-loop (src/lanes). Reads packages/cli.", fences.A), ["packages/dev-loop"], "the Write ownership line wins");
  assert.deepEqual(writesOf("Change packages/agent-link and apps/desktop/src/main/x.ts.", fences.A), ["packages/agent-link", "apps/desktop/src/main"]);
  assert.deepEqual(writesOf("Needs: Mint (track A)", fences.A), fences.A, "naming no package, it writes the whole fence");

  const running = [{ id: "busy", writes: ["packages/dev-loop"] }];
  const work = survey([increment("clash", "packages/dev-loop/src/lanes", { parked: "2026-10-01T00:00:00Z" }),
    increment("unknown", "Needs: Mint (track A)", { parked: "2026-10-02T00:00:00Z" }), increment("free", "packages/agent-link")]);
  const { pick, skipped } = pickNext(work, { track: "A", fences, running });
  assert.equal(pick, "free");
  assert.deepEqual(skipped, [{ id: "clash", why: "shares packages/dev-loop with running busy" }, { id: "unknown", why: "shares packages/dev-loop with running busy" }]);

  const dir = await mkdtemp(join(tmpdir(), "lane-beside-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const queue = join(dir, "night-queue-A.txt"), stop = join(dir, "night-stop");
  await writeFile(queue, "lanes\nsame\nmain\n");
  const looks = survey([increment("lanes", "Write ownership: packages/dev-loop (src/lanes)"), increment("same", "packages/dev-loop/src/gate.mjs"),
    increment("main", "Write ownership: apps/desktop/src/main"), increment("library", "packages/agent-link")]);
  const started = [], done = {}, lines = [];
  const fed = keepFed({ track: "A", fences, queueFile: queue, stopFile: stop, now: () => now, say: (line) => lines.push(line), limit: async () => 2,
    survey: async () => looks, sleep: (ms, { signal } = {}) => new Promise((go) => signal?.addEventListener("abort", go)),
    runLane: (id) => { started.push(id); return new Promise((end) => { done[id] = end; }); } });
  const until = async (ready) => { for (let turn = 0; turn < 3000 && !ready(); turn++) await new Promise((go) => setTimeout(go, 1)); assert.ok(ready()); };
  await until(() => started.length === 2);
  assert.deepEqual(started, ["lanes", "main"], "same shares packages/dev-loop with lanes, so main runs beside it");
  assert.ok(lines.some((line) => /start main beside lanes: no shared package/.test(line)));
  done.main(0);
  await until(() => started.length === 3);
  assert.equal(started[2], "library", "with no queued line it may run beside, it takes disjoint work from the library");
  assert.equal(await readFile(queue, "utf8"), "lanes\nsame\nlibrary\n");
  await writeFile(stop, "");
  done.lanes(0); done.library(0);
  assert.equal(await fed, 0);
  assert.deepEqual(started, ["lanes", "main", "library"]);
});

test("11.6 · work in a track's queue carries the runner's event wait, which comes off before its lane starts; a wait someone else wrote is left alone", async (t) => {
  const calls = [];
  const library = {
    holds: async () => ({ waits: {}, heldOn: {}, waitsFor: {
      starting: [{ releaser: "event", note: "queued on Mint track A, behind x", checkBack: "2026-10-08", holds: true }],
      theirs: [{ releaser: "event", note: "waits for the deploy", checkBack: "2026-10-09", holds: true }],
      second: [{ releaser: "event", note: "queued on Mint track A, behind old", checkBack: "2026-10-07", holds: false }],
    } }),
    addWaitFor: async (id, wait, options) => { calls.push(["add", id, wait.releaser, wait.note, wait.checkBack, options.actor]); },
    removeWaitFor: async (id, releaser, options) => { calls.push(["remove", id, releaser, options.actor]); },
  };
  await markQueue({ library, track: "A", starting: "starting", running: ["other"], queued: ["second", "theirs", "third"], now });
  assert.deepEqual(calls, [
    ["remove", "starting", "event", "runner:mint-track-A"],
    ["add", "second", "event", "queued on Mint track A, behind other, starting", "2026-10-08", "runner:mint-track-A"],
    ["add", "third", "event", "queued on Mint track A, behind theirs", "2026-10-08", "runner:mint-track-A"],
  ]);
  calls.length = 0;
  await markQueue({ library, track: "A", starting: "theirs", queued: [], now });
  assert.deepEqual(calls, [], "a starting increment's wait someone else wrote stays");

  const held = survey([increment("evented", "packages/dev-loop", { parked: "2026-10-01T00:00:00Z" }), increment("owned", "packages/dev-loop", { parked: "2026-10-02T00:00:00Z" }),
    increment("lapsed", "packages/dev-loop", { parked: "2026-10-03T00:00:00Z" })], { holds: { waits: {}, heldOn: {}, waitsFor: {
    evented: [{ releaser: "event", note: "the deploy", holds: true }], owned: [{ releaser: "owner", note: "sign-in", holds: true }],
    lapsed: [{ releaser: "event", note: "queued on Mint track B, behind y", holds: false }] } } });
  const { pick, skipped } = pickNext(held, { track: "A", fences });
  assert.equal(pick, "lapsed", "a wait past its check-back day holds nothing");
  assert.deepEqual(skipped, [{ id: "evented", why: "waits for an event: the deploy" }, { id: "owned", why: "waits for the owner: sign-in" }]);

  const dir = await mkdtemp(join(tmpdir(), "lane-marks-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const queue = join(dir, "night-queue-A.txt"), stop = join(dir, "night-stop");
  await writeFile(queue, "first\nsecond\n");
  const order = [];
  await keepFed({ track: "A", fences, queueFile: queue, stopFile: stop, now: () => now, say: (line) => order.push(line),
    survey: async () => survey([]), sleep: () => assert.fail("no wait"),
    markQueue: async (marks) => { order.push(["mark", marks]); if (marks.starting === "second") throw new Error("library unreachable"); },
    runLane: async (id) => { order.push(["lane", id]); if (id === "second") await writeFile(stop, ""); return 0; } });
  assert.deepEqual(order.filter((one) => Array.isArray(one)), [
    ["mark", { track: "A", starting: "first", running: [], queued: ["second"] }], ["lane", "first"],
    ["mark", { track: "A", starting: "second", running: [], queued: [] }], ["lane", "second"]]);
  assert.ok(order.some((line) => /queue waits not written \(library unreachable\); the lane runs anyway/.test(line)));
});

test("11.5 · a refill skips an increment queued or running on any track's queue", async (t) => {
  const work = survey([increment("taken", "packages/dev-loop", { parked: "2026-10-01T00:00:00Z" }), increment("free", "packages/dev-loop")]);
  const { pick, skipped } = pickNext(work, { track: "A", fences, queued: new Map([["taken", "G"]]) });
  assert.equal(pick, "free");
  assert.deepEqual(skipped, [{ id: "taken", why: "queued on track G" }]);

  const dir = await mkdtemp(join(tmpdir(), "lane-feed-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const queue = join(dir, "night-queue-A.txt"), stop = join(dir, "night-stop");
  await writeFile(queue, "");
  await writeFile(join(dir, "night-queue-G.txt"), "taken\n");
  await writeFile(join(dir, "night-queue-G.txt.bak-20261007"), "free\n");
  const ran = [];
  await keepFed({ track: "A", fences, queueFile: queue, stopFile: stop, now: () => now, say: () => {},
    queued: () => queuedOnTracks(dir), survey: async () => work,
    runLane: async (id) => { ran.push(id); await writeFile(stop, ""); return 0; }, sleep: () => assert.fail("no wait") });
  assert.deepEqual(ran, ["free"]);
  assert.deepEqual([...(await queuedOnTracks(dir))], [["taken", "G"]], "only live queue files count, not backups");
});

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { laneLimit, main, poolRules, prepareCheckout, PUSH_URL, runPool } from "./launch.mjs";

const run = promisify(execFile);
const now = () => Date.parse("2026-10-08T04:00:00Z");
async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), "lane-launch-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

async function box(t, extra = {}) {
  const lanesDir = await folder(t);
  await writeFile(join(lanesDir, "night-fences.txt"), "A=packages/dev-loop, apps/desktop/src/main\nB=packages/app\n");
  await writeFile(join(lanesDir, "night-common.md"), "Common rules.\n");
  const events = [], lines = [], briefs = [], marks = [];
  const counts = [5, 4];
  return {
    lanesDir, events, lines, briefs, marks, repo: join(lanesDir, "repo"), addDirs: ["/wt", lanesDir], pid: 4242, now,
    markQueue: async (one) => { marks.push(one); },
    say: (line) => lines.push(line), argsOf: async () => "", maxLanes: async () => 5,
    count: async () => { events.push("count"); return counts.length ? counts.shift() : 0; },
    lock: async (fn) => { events.push("lock"); await fn(); events.push("unlock"); },
    prepare: async () => { events.push("prepare"); },
    sleep: async () => { events.push("sleep"); if (events.filter((one) => one === "sleep").length === 2) await writeFile(join(lanesDir, "night-stop"), ""); },
    survey: async () => ({ increments: [], holds: { waits: {}, heldOn: {} }, claims: [], laptopArcs: [] }),
    runLane: async (options) => {
      events.push("lane");
      briefs.push(await readFile(options.brief, "utf8"));
      assert.equal(options.cwd, join(lanesDir, "repo"));
      assert.deepEqual(options.addDirs, ["/wt", lanesDir]);
      options.say("engine codex Codex weekly allowance 77% used");
      return 0;
    },
    ...extra,
  };
}

test("12.5 · each lane waits for a slot and updates the checkout under the shared lock, then runs its brief through the lane runner", async (t) => {
  const b = await box(t);
  await writeFile(join(b.lanesDir, "night-queue-A.txt"), "increment_one\n");
  await writeFile(join(b.lanesDir, "night-notes-increment_one.md"), "Notes for one.\n");
  assert.equal(await main(["night", "A"], b), 0);
  assert.deepEqual(b.events, ["lock", "count", "sleep", "count", "prepare", "unlock", "lane", "sleep"]);
  assert.equal(b.briefs[0], "# Overnight lane: track A, increment_one\n\nYour increment: increment_one. Your track: A. Your write fence: packages/dev-loop, apps/desktop/src/main.\n\nNotes for one.\n\nCommon rules.\n");
  assert.equal(await readFile(join(b.lanesDir, "night-A-increment_one-brief.md"), "utf8"), b.briefs[0]);
  assert.equal(await readFile(join(b.lanesDir, "night-queue-A.txt"), "utf8"), "");
  assert.equal((await readFile(join(b.lanesDir, "night-A.pid"), "utf8")).trim(), "4242");
  assert.deepEqual(b.marks, [{ track: "A", starting: "increment_one", running: [], queued: [] }], "the track's queue waits are kept as its lane starts");
  const status = b.lines.join("\n");
  for (const line of ["waiting for a slot (5 engines running) before increment_one", "start increment_one", "engine codex Codex weekly allowance 77% used",
    "end increment_one exit 0", "nothing ready in track A's fence", "stopped by night-stop", "track done"]) assert.ok(status.includes(line), line);

  const refused = await box(t, { argsOf: async () => "bash /home/m/storytree-lanes/launch-night.sh run A" });
  await writeFile(join(refused.lanesDir, "night-A.pid"), "77\n");
  assert.equal(await main(["night", "A"], refused), 1);
  assert.deepEqual(refused.events, []);
  assert.match(refused.lines[0], /runner 4242 not started: runner 77 still drives track A/);
  assert.equal(await main(["night", "Z"], await box(t)), 1, "a track night-fences.txt lacks does not start");
  assert.equal(await main(["nonsense"], { ...(await box(t)), out: () => {} }), 2);
});

test("12.6 · a track's lane limit is its line in night-lanes-per-track, else 1, and two lanes writing different packages run at once", async (t) => {
  assert.equal(laneLimit("A=2\nB=3\n", "A"), 2);
  assert.equal(laneLimit("A=2\n", "B"), 1, "a track not named runs one lane");
  for (const bad of ["A=0", "A=two", "A=1.5", ""]) assert.equal(laneLimit(bad, "A"), 1, bad);

  const looks = { increments: [
    { id: "inc_lanes", arc: "arc_a", arcState: "active", body: "Write ownership: packages/dev-loop", status: "proposal", parked: "2026-10-06T00:00:00Z" },
    { id: "inc_main", arc: "arc_a", arcState: "active", body: "Write ownership: apps/desktop/src/main", status: "proposal", parked: "2026-10-06T00:00:00Z" },
  ], holds: { waits: {}, heldOn: {} }, claims: [], laptopArcs: [] };
  let at = 0, most = 0;
  const b = await box(t, { count: async () => 0, survey: async () => looks, sleep: async () => { await writeFile(join(b.lanesDir, "night-stop"), ""); },
    runLane: async () => { most = Math.max(most, ++at); await new Promise((go) => setTimeout(go, 20)); at--; return 0; } });
  await writeFile(join(b.lanesDir, "night-queue-A.txt"), "inc_lanes\ninc_main\n");
  await writeFile(join(b.lanesDir, "night-lanes-per-track"), "A=2\n");
  assert.equal(await main(["night", "A"], b), 0);
  assert.equal(most, 2, "both lanes ran at once");
  assert.equal(await readFile(join(b.lanesDir, "night-queue-A.txt"), "utf8"), "");
});

test("12.7 · a track with its own common brief composes its lanes from it; other tracks keep night-common.md", async (t) => {
  const briefs = [];
  for (const [track, increment] of [["R", "increment_review"], ["A", "increment_build"]]) {
    const b = await box(t);
    await writeFile(join(b.lanesDir, "night-fences.txt"), "A=packages/dev-loop\nR=read-only: reviews that write no package\n");
    await writeFile(join(b.lanesDir, "night-common-R.md"), "Read-only rules.\n");
    await writeFile(join(b.lanesDir, `night-queue-${track}.txt`), `${increment}\n`);
    assert.equal(await main(["night", track], b), 0);
    briefs.push(...b.briefs);
  }
  assert.equal(briefs[0], "# Overnight lane: track R, increment_review\n\nYour increment: increment_review. Your track: R. Your write fence: read-only: reviews that write no package.\n\nRead-only rules.\n");
  assert.match(briefs[1], /\n\nCommon rules\.\n$/, "a track without its own common brief keeps night-common.md");
});

test("12.2 ·the mintlib queue stops on a failed lane, keeping it queued, and refuses to start without its common brief", async (t) => {
  const b = await box(t, { runLane: async () => 1 });
  await writeFile(join(b.lanesDir, "mintlib-queue.txt"), "increment_lib\nincrement_after\n");
  assert.equal(await main(["mintlib"], b), 1, "missing mintlib-common.md");
  await writeFile(join(b.lanesDir, "mintlib-common.md"), "Library rules.\n");
  assert.equal(await main(["mintlib"], b), 1);
  assert.equal(await readFile(join(b.lanesDir, "mintlib-queue.txt"), "utf8"), "increment_lib\nincrement_after\n");
  assert.match(await readFile(join(b.lanesDir, "mintlib-increment_lib-brief.md"), "utf8"), /^# Lane: arc_34390ae9d2e1, increment_lib\n\nYour increment: increment_lib\. Your write fence: .*\n\nLibrary rules\.\n$/);
  assert.ok(b.lines.some((line) => line.endsWith("lane for increment_lib failed: stopping with it still queued")));
  const slots = [];
  assert.equal(await main(["slots"], { ...b, count: async () => 3, out: (line) => slots.push(line) }), 0);
  assert.deepEqual(slots, ["3 engines running, cap 5"]);
});

test("12.5 · the prepared checkout is at origin/main and pushes over SSH, leaving fetches on the original origin", async (t) => {
  const dir = await folder(t);
  const origin = join(dir, "origin.git"), seed = join(dir, "seed"), repo = join(dir, "repo");
  const git = (cwd, ...args) => run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd });
  await git(dir, "init", "-q", "--bare", "-b", "main", origin);
  await mkdir(seed);
  await git(seed, "init", "-q", "-b", "main");
  await writeFile(join(seed, "a.txt"), "one\n");
  await git(seed, "add", "a.txt"); await git(seed, "commit", "-q", "-m", "one");
  await git(seed, "push", "-q", origin, "main");
  await git(dir, "clone", "-q", origin, repo);
  await writeFile(join(seed, "a.txt"), "two\n");
  await git(seed, "commit", "-q", "-am", "two"); await git(seed, "push", "-q", origin, "main");
  const ran = [];
  await prepareCheckout({ repo, exec: async (command, args, options) => {
    ran.push(command);
    return command === "git" ? git(options.cwd, ...args) : { stdout: "" };
  } });
  assert.deepEqual(ran, ["git", "git", "git", "pnpm"]);
  assert.equal((await readFile(join(repo, "a.txt"), "utf8")).trim(), "two");
  assert.equal((await git(repo, "remote", "get-url", "--push", "origin")).stdout.trim(), PUSH_URL);
  assert.equal((await git(repo, "remote", "get-url", "origin")).stdout.trim(), origin);
});

function poolWork(ids, extra = {}) {
  return {
    increments: ids.map((id, at) => ({ id, arc: `arc_${id}`, arcState: "active", title: id, body: extra.bodies?.[id] ?? "", status: "proposal", parked: `2026-10-0${at + 1}T00:00:00Z` })),
    holds: { waits: {}, heldOn: {} }, claims: extra.claims ?? [], laptopArcs: [],
  };
}

test("12.8 · the dispatcher fills free slots up to the cap and no further, never starts one increment twice, and retries a refused one only once its claim clears", async () => {
  const lines = [], started = [], ends = new Map();
  let engines = 1, looks = 0, stop = false;
  let claims = [];
  const code = await runPool({
    survey: async () => poolWork(["a", "b", "c", "d"], { claims }), maxLanes: async () => 3, count: async () => engines,
    stopFile: "/lanes/pool-stop", exists: async () => stop, now, say: (line) => lines.push(line),
    launch: (one, { engineUp }) => new Promise((done) => { started.push(one.id); engines += 1; engineUp(); ends.set(one.id, done); }),
    sleep: async () => {
      looks += 1;
      await new Promise((go) => setImmediate(go));
      if (looks === 2) {
        assert.deepEqual(started, ["a", "b"], "two free slots beside one engine: two started, no more");
        claims = [{ increment: "c", session: "other", holder: "live", since: "2026-10-08T03:00:00Z" }];
        engines -= 1; ends.get("a")(0);
      } else if (looks === 4) {
        assert.deepEqual(started, ["a", "b", "d"], "c is claimed by a live session, a already ran: d fills the freed slot");
        engines -= 1; ends.get("b")(0);
      } else if (looks === 6) {
        claims = [];
      } else if (looks === 8) {
        stop = true;
        for (const id of ["c", "d"]) { engines -= 1; ends.get(id)?.(0); }
      }
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(started, ["a", "b", "d", "c"], "c ran once its claim cleared");
  assert.ok(lines.some((line) => /nothing ready for 1 free slot/.test(line)));
  assert.match(lines.at(-1), /stopped by/);
});

test("12.9 · `pool` starts each ready increment under the shared lock with the repository's pool brief, read-only work with the read-only rules", async (t) => {
  const b = await box(t, {
    survey: async () => poolWork(["increment_build", "increment_review"], { bodies: { increment_review: "needs: read-only, blind" } }),
    count: async () => 0, maxLanes: async () => 2,
  });
  const ran = [];
  b.runLane = async (options) => { ran.push(await readFile(options.brief, "utf8")); options.say("2026-10-08T04:00:00Z engine claude allowance used"); return 0; };
  b.sleep = async () => { await new Promise((go) => setImmediate(go)); if (ran.length === 2) await writeFile(join(b.lanesDir, "pool-stop"), ""); };
  assert.equal(await main(["pool"], b), 0);
  const build = ran.find((brief) => brief.startsWith("# Pool lane: increment_build"));
  const review = ran.find((brief) => brief.startsWith("# Pool lane: increment_review"));
  assert.ok(build.includes(await poolRules("")) && /no write fence/i.test(build));
  assert.ok(review.includes(await poolRules("needs: read-only")) && /blind reviewer/.test(review));
  assert.ok(b.lines.some((line) => /start increment_build/.test(line)) && b.lines.some((line) => /end increment_review exit 0/.test(line)));
  assert.equal(b.events.filter((one) => one === "lock").length, 2);
  b.argsOf = async () => "node launch.mjs pool";
  await writeFile(join(b.lanesDir, "pool.pid"), "99\n");
  assert.equal(await main(["pool"], b), 1, "one dispatcher at a time");
});

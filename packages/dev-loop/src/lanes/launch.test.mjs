import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { main, planRules, poolRules, prepareCheckout, PUSH_URL, runPool } from "./launch.mjs";
import { codeVersion } from "./queue.mjs";

const run = promisify(execFile);
const now = () => Date.parse("2026-10-08T04:00:00Z");
async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), "lane-launch-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

async function box(t, extra = {}) {
  const lanesDir = await folder(t);
  const events = [], lines = [], briefs = [];
  const counts = [5, 4];
  return {
    lanesDir, events, lines, briefs, repo: join(lanesDir, "repo"), addDirs: ["/wt", lanesDir], pid: 4242, now,
    say: (line) => lines.push(line), argsOf: async () => "", maxLanes: async () => 5,
    count: async () => { events.push("count"); return counts.length ? counts.shift() : 0; },
    lock: async (fn) => { events.push("lock"); await fn(); events.push("unlock"); },
    prepare: async () => { events.push("prepare"); },
    sleep: async () => { events.push("sleep"); if (events.filter((one) => one === "sleep").length === 2) await writeFile(join(lanesDir, "pool-stop"), ""); },
    survey: async () => ({ increments: [], holds: { waits: {}, heldOn: {} }, claims: [] }),
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
  let locked = false, waited = false;
  const b = await box(t, {
    survey: async () => poolWork(["increment_one"]), rules: async () => "Pool rules.\n",
    lock: async (fn) => { b.events.push("lock"); locked = true; await fn(); locked = false; b.events.push("unlock"); },
    count: async () => { if (!locked || waited) return 0; waited = true; return 5; },
    sleep: async () => { b.events.push("sleep"); await new Promise((go) => setImmediate(go)); if (b.briefs.length) await writeFile(join(b.lanesDir, "pool-stop"), ""); },
  });
  await writeFile(join(b.lanesDir, "pool-notes-increment_one.md"), "Notes for one.\n");
  assert.equal(await main(["pool"], b), 0);
  assert.deepEqual(b.events.filter((one) => one !== "sleep"), ["lock", "prepare", "unlock", "lane"]);
  assert.equal(b.briefs[0], "# Pool lane: increment_one\n\nYour increment: increment_one.\n\nNotes for one.\n\nPool rules.\n");
  assert.equal(await readFile(join(b.lanesDir, "pool-increment_one-brief.md"), "utf8"), b.briefs[0]);
  assert.equal((await readFile(join(b.lanesDir, "pool.pid"), "utf8")).trim(), "4242");
  const status = b.lines.join("\n");
  for (const line of ["waiting for a slot (5 engines running) before increment_one", "start increment_one", "engine codex Codex weekly allowance 77% used",
    "end increment_one exit 0", "stopped by pool-stop", "dispatcher ended"]) assert.ok(status.includes(line), line);
  assert.equal(await main(["nonsense"], { ...b, out: () => {} }), 2);
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
    holds: { waits: {}, heldOn: {} }, claims: extra.claims ?? [],
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
  const ran = [], followed = [];
  b.runLane = async (options) => { ran.push(await readFile(options.brief, "utf8")); followed.push(options.increment); options.say("2026-10-08T04:00:00Z engine claude allowance used"); return 0; };
  b.sleep = async () => { await new Promise((go) => setImmediate(go)); if (ran.length === 2) await writeFile(join(b.lanesDir, "pool-stop"), ""); };
  assert.equal(await main(["pool"], b), 0);
  const build = ran.find((brief) => brief.startsWith("# Pool lane: increment_build"));
  const review = ran.find((brief) => brief.startsWith("# Pool lane: increment_review"));
  assert.ok(build.includes(await poolRules("")) && /no write fence/i.test(build));
  assert.ok(review.includes(await poolRules("needs: read-only")) && /blind reviewer/.test(review));
  assert.ok(b.lines.some((line) => /start increment_build/.test(line)) && b.lines.some((line) => /end increment_review exit 0/.test(line)));
  assert.equal(b.events.filter((one) => one === "lock").length, 2);
  assert.deepEqual(followed.sort(), ["increment_build", "increment_review"], "the runner checks what each lane left for its increment");
  b.argsOf = async () => "node launch.mjs pool";
  await writeFile(join(b.lanesDir, "pool.pid"), "99\n");
  assert.equal(await main(["pool"], b), 1, "one dispatcher at a time");
});

test("12.10 · the dispatcher restarts between sessions when its own code changes, and not otherwise", async () => {
  const lines = [], started = [], ends = new Map(), refreshed = [];
  let version = "tree-a", engines = 0;
  const code = await runPool({
    survey: async () => poolWork(["a", "b"]), maxLanes: async () => 1, count: async () => engines,
    codeVersion: async () => version, refresh: async () => { refreshed.push(version); },
    stopFile: "/lanes/pool-stop", exists: async () => false, now, say: (line) => lines.push(line),
    launch: (one, { engineUp }) => new Promise((done) => {
      started.push(one.id); engines += 1; engineUp();
      ends.set(one.id, () => { engines -= 1; lines.push(`ended ${one.id}`); done(0); });
    }),
    sleep: async () => { version = "tree-b"; setTimeout(() => ends.get("a")(), 5); },
  });
  assert.equal(code, 3);
  assert.deepEqual(started, ["a"], "nothing new starts once the code changed; b waits for the restarted dispatcher");
  assert.deepEqual(lines.slice(-2).map((line) => line.replace(/^\S+Z /, "")), ["ended a", "dev loop code changed (tree-a → tree-b): restarting"],
    "the running session ends before the dispatcher does");

  version = "tree-a";
  const idle = await runPool({
    survey: async () => { throw new Error("record was written on schema version 3, which is newer than version 2"); },
    maxLanes: async () => 1, count: async () => 0, codeVersion: async () => version, refresh: async () => { refreshed.push("idle"); version = "tree-c"; },
    stopFile: "/lanes/pool-stop", exists: async () => false, now, say: () => {}, launch: async () => assert.fail("nothing launches"), sleep: async () => {},
  });
  assert.equal(idle, 3, "a failing survey brings the checkout up to date and restarts on the new code");
  assert.deepEqual(refreshed, ["idle"], "the checkout is refreshed only when no session starts");

  let stop = false;
  const steady = await runPool({
    survey: async () => poolWork([]), maxLanes: async () => 1, count: async () => 0, codeVersion: async () => "tree-a", refresh: async () => { refreshed.push("steady"); },
    stopFile: "/lanes/pool-stop", exists: async () => stop, now, say: () => {}, launch: async () => 0, sleep: async () => { stop = true; },
  });
  assert.equal(steady, 0, "unchanged code: no restart");
  assert.deepEqual(refreshed, ["idle", "steady"]);
});

test("12.10 · its own code is the code it runs: a merge touching only other dev loop code leaves it starting work", async (t) => {
  const repo = await folder(t);
  const git = (...args) => run("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
  const commit = async (path, text) => {
    await mkdir(join(repo, path, ".."), { recursive: true });
    await writeFile(join(repo, path), text);
    await git("add", "-A");
    await git("commit", "-qm", path);
  };
  await git("init", "-q");
  await commit("packages/dev-loop/src/lanes/launch.mjs", "pool v1");
  await commit("packages/dev-loop/src/test-runner.mjs", "tests v1");
  const dispatch = async (merge) => {
    const started = [];
    let stop = false;
    const code = await runPool({
      survey: async () => poolWork(["a", "b"]), maxLanes: async () => 1, count: async () => 0,
      codeVersion: () => codeVersion({ repo }), refresh: async () => {},
      stopFile: "/lanes/pool-stop", exists: async () => stop, now, say: () => {},
      // The merge lands, and the shared checkout reaches it, while the first session runs.
      launch: async (one) => { started.push(one.id); if (started.length === 1) await merge(); return 0; },
      sleep: async () => { if (started.length === 2) stop = true; },
    });
    return { code, started };
  };
  const elsewhere = await dispatch(() => commit("packages/dev-loop/src/test-runner.mjs", "tests v2"));
  assert.deepEqual(elsewhere, { code: 0, started: ["a", "b"] }, "the test runner changed: no restart, and b starts after the merge");
  const own = await dispatch(() => commit("packages/dev-loop/src/lanes/launch.mjs", "pool v2"));
  assert.deepEqual(own, { code: 3, started: ["a"] }, "the dispatcher's code changed: it restarts, starting nothing more");
});

test("12.11 · with free slots and nothing ready, one planning session starts for a qualifying arc, never two at once", async (t) => {
  const arcs = [{ id: "arc_old", state: "active", title: "Old", created: "2026-10-01T00:00:00Z", openQuestions: 0 },
    { id: "arc_new", state: "active", title: "New", created: "2026-10-02T00:00:00Z", openQuestions: 0 }];
  const started = [], ends = new Map();
  let looks = 0, stop = false;
  const code = await runPool({
    survey: async () => ({ ...poolWork([]), arcs }), maxLanes: async () => 3, count: async () => 0,
    stopFile: "/lanes/pool-stop", exists: async () => stop, now, say: () => {},
    launch: (one, { engineUp }) => new Promise((done) => { started.push(`${one.plan ? "plan" : "build"}:${one.id}`); engineUp(); ends.set(one.id, done); }),
    sleep: async () => {
      looks += 1;
      await new Promise((go) => setImmediate(go));
      if (looks === 3) { assert.deepEqual(started, ["plan:arc_old"], "three free slots, one planning session"); ends.get("arc_old")(0); }
      else if (looks === 5) { assert.deepEqual(started, ["plan:arc_old", "plan:arc_new"], "each arc planned once"); ends.get("arc_new")(0); stop = true; }
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(started, ["plan:arc_old", "plan:arc_new"]);

  const b = await box(t, { survey: async () => ({ ...poolWork([]), arcs: [arcs[0]] }), count: async () => 0, maxLanes: async () => 1 });
  b.runLane = async (options) => { b.briefs.push(await readFile(options.brief, "utf8")); assert.equal(options.increment, undefined, "a planning lane is not checked for a push"); return 0; };
  b.sleep = async () => { await new Promise((go) => setImmediate(go)); if (b.briefs.length) await writeFile(join(b.lanesDir, "pool-stop"), ""); };
  assert.equal(await main(["pool"], b), 0);
  assert.ok(b.briefs[0].startsWith("# Planning lane: arc_old\n\nYour arc: arc_old (Old)."));
  assert.ok(b.briefs[0].includes(await planRules()) && /never build/i.test(b.briefs[0]));
});

test("12.12 · an increment handed to the watcher is not offered while its hand-off stands, its fix session running or not", async (t) => {
  const b = await box(t, { survey: async () => poolWork(["increment_handed", "increment_fixing", "increment_free"]), count: async () => 0, maxLanes: async () => 3 });
  await mkdir(join(b.lanesDir, "watch"), { recursive: true });
  await writeFile(join(b.lanesDir, "watch", "41.json"), JSON.stringify({ pr: 41, increment: "increment_handed", fixes: [], fixing: null }));
  await writeFile(join(b.lanesDir, "watch", "42.json"), JSON.stringify({ pr: 42, increment: "increment_fixing", fixes: [{}], fixing: { pid: 7 } }));
  const started = [];
  b.runLane = async (options) => { started.push((await readFile(options.brief, "utf8")).split("\n")[0]); return 0; };
  b.sleep = async () => { await new Promise((go) => setImmediate(go)); await writeFile(join(b.lanesDir, "pool-stop"), ""); };
  assert.equal(await main(["pool"], b), 0);
  assert.deepEqual(started, ["# Pool lane: increment_free"], "the handed-over increment and the one a fix session works are left to the watcher");
});

test("12.13 · with free slots and nothing ready the dispatcher looks again within minutes; full slots poll, and a failing survey backs off", async () => {
  const pauses = [];
  let looks = 0, stop = false, fail = false, engines = 0;
  await runPool({
    survey: async () => { if (fail) throw new Error("library down"); return poolWork([]); }, maxLanes: async () => 2, count: async () => engines,
    stopFile: "/lanes/pool-stop", exists: async () => stop, now, say: () => {}, launch: async () => 0,
    sleep: async (ms) => {
      pauses.push(ms);
      looks += 1;
      if (looks === 1) engines = 2;
      else if (looks === 2) { engines = 0; fail = true; }
      else stop = true;
    },
  });
  assert.deepEqual(pauses, [2 * 60_000, 60_000, 15 * 60_000], "idle with free slots: two minutes; every slot busy: a minute without a survey; survey failed: fifteen");
});

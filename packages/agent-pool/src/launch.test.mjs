import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { removeTemp } from "@storytree/test-waits";

import { main, planRules, poolRules, prepareCheckout, PUSH_URL, runPool, startHold, withLockFile } from "./launch.mjs";
import { codeVersion } from "./queue.mjs";
import { SIGNALED } from "./runner.mjs";

const run = promisify(execFile);
const now = () => Date.parse("2026-10-08T04:00:00Z");
async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), "lane-launch-"));
  t.after(() => removeTemp(path));
  return path;
}

async function box(t, extra = {}) {
  const lanesDir = await folder(t);
  const events = [], lines = [], briefs = [];
  const counts = [5, 4];
  return {
    lanesDir, events, lines, briefs, repo: join(lanesDir, "repo"), addDirs: ["/wt", lanesDir], pid: 4242, now,
    say: (line) => lines.push(line), argsOf: async () => "", maxLanes: async () => 5,
    // A clear box: the real reading (/proc on a busy CI runner) would hold dispatch back (pace.mjs).
    pace: async () => undefined, briefPaths: undefined,
    // Plugged in and online: the real readings (the power line, the library and GitHub) are the start rule's tests' own (3.27).
    power: async () => "Online", online: async () => true,
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

test("3.5 · each lane waits for a slot and updates the checkout under the shared lock, then runs its brief through the lane runner", async (t) => {
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

test("3.5 · the prepared checkout is at origin/main, installed from its lockfile unchanged, and pushes over SSH, leaving fetches on the original origin", async (t) => {
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
  let install;
  await prepareCheckout({ repo, exec: async (command, args, options) => {
    ran.push(command);
    if (command === "pnpm") install = args;
    return command === "git" ? git(options.cwd, ...args) : { stdout: "" };
  } });
  assert.deepEqual(ran, ["git", "git", "git", "git", "pnpm"]);
  assert.deepEqual(install, ["install", "--frozen-lockfile", "--silent"]);
  assert.equal((await readFile(join(repo, "a.txt"), "utf8")).trim(), "two");
  assert.equal((await git(repo, "remote", "get-url", "--push", "origin")).stdout.trim(), PUSH_URL);
  assert.equal((await git(repo, "remote", "get-url", "origin")).stdout.trim(), origin);
});

test("3.5 · a checkout that already pushes to the repository over SSH, through the box's deploy key or the account's, keeps its push URL", async (t) => {
  const repo = await folder(t);
  const git = (...args) => run("git", args, { cwd: repo });
  await git("init", "-q");
  await git("remote", "add", "origin", "https://github.com/storytree-ai/storytree.git");
  const prepare = () => prepareCheckout({ repo, exec: async (command, args, options) => {
    if (command === "git" && args[0] === "config") return run(command, args, options);
    return { stdout: "" };
  } });
  for (const kept of ["git@github.com-storytree:storytree-ai/storytree.git", PUSH_URL]) {
    await git("config", "remote.origin.pushurl", kept);
    await prepare();
    assert.equal((await git("config", "--get", "remote.origin.pushurl")).stdout.trim(), kept);
  }
  // One that pushes anywhere else is pointed back at the repository over SSH.
  await git("config", "remote.origin.pushurl", "https://github.com/storytree-ai/storytree.git");
  await prepare();
  assert.equal((await git("config", "--get", "remote.origin.pushurl")).stdout.trim(), PUSH_URL);
});

function poolWork(ids, extra = {}) {
  return {
    increments: ids.map((id, at) => ({ id, arc: `arc_${id}`, arcState: "active", title: id, body: extra.bodies?.[id] ?? "", status: "proposal", parked: `2026-10-0${at + 1}T00:00:00Z` })),
    holds: { waits: {}, heldOn: {} }, claims: extra.claims ?? [],
  };
}

test("3.8 · the dispatcher fills free slots up to the cap and no further, never starts one increment twice, and retries a refused one only once its claim clears", async () => {
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

test("3.9 · `pool` starts each ready increment under the shared lock with the repository's pool brief, read-only work with the read-only rules", async (t) => {
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

test("3.22 · an increment that closes or is claimed between the survey and its lane's start starts no lane, and one claimed meanwhile starts once that claim clears", async (t) => {
  let closed = false, claims = [];
  const work = () => {
    const found = poolWork(["increment_closes", "increment_claimed"], { claims });
    if (closed) found.increments[0].status = "closed";
    return found;
  };
  const ran = [];
  const b = await box(t, {
    survey: async () => work(), count: async () => 0, maxLanes: async () => 2,
    // Both are picked from one survey; then, while the checkout is prepared, one closes and the other is claimed.
    prepare: async () => {
      if (closed) return;
      closed = true;
      claims = [{ increment: "increment_claimed", session: "other", holder: "live", since: "2026-10-08T03:59:00Z" }];
    },
    runLane: async (options) => { ran.push(options.increment); return 0; },
    sleep: async () => {
      await new Promise((go) => setImmediate(go));
      if (b.lines.some((line) => /not starting increment_claimed/.test(line))) claims = [];
      if (ran.length) await writeFile(join(b.lanesDir, "pool-stop"), "");
    },
  });
  assert.equal(await main(["pool"], b), 0);
  assert.deepEqual(ran, ["increment_claimed"], "the closed one never starts; the claimed one starts once its claim clears, with no back-off");
  const status = b.lines.join("\n");
  assert.match(status, /not starting increment_closes: it is closed/);
  assert.match(status, /not starting increment_claimed: held by live session other/);
  assert.ok(!/start increment_closes/.test(status));
});

test("3.10 · the dispatcher restarts between sessions when its own code changes, and not otherwise", async () => {
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

  // A slow read (a loaded box) that began before the merge landed answers only after the session has ended.
  let tree = "tree-a", endSession;
  const slowStarted = [];
  const slow = await runPool({
    survey: async () => poolWork(["a", "b"]), maxLanes: async () => 1, count: async () => 0,
    codeVersion: () => {
      const seen = tree, end = endSession;
      if (!end) return Promise.resolve(seen);
      endSession = undefined;
      tree = "tree-b";
      end(0);
      return new Promise((go) => setImmediate(go)).then(() => seen);
    },
    stopFile: "/lanes/pool-stop", exists: async () => false, now, say: () => {},
    launch: (one) => { slowStarted.push(one.id); return new Promise((done) => { endSession = done; }); },
    sleep: async () => {},
  });
  assert.deepEqual({ slow, slowStarted }, { slow: 3, slowStarted: ["a"] }, "a version read from before the session ended never lets the next one start");
});

test("3.10 · its own code is the code it runs: a merge touching only other dev loop code leaves it starting work", async (t) => {
  const repo = await folder(t);
  const git = (...args) => run("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo });
  const commit = async (path, text) => {
    await mkdir(join(repo, path, ".."), { recursive: true });
    await writeFile(join(repo, path), text);
    await git("add", "-A");
    await git("commit", "-qm", path);
  };
  await git("init", "-q");
  await commit("packages/agent-pool/src/launch.mjs", "pool v1");
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
  const own = await dispatch(() => commit("packages/agent-pool/src/launch.mjs", "pool v2"));
  assert.deepEqual(own, { code: 3, started: ["a"] }, "the dispatcher's code changed: it restarts, starting nothing more");
  const configured = await dispatch(() => commit("agent-pool.json", "{\"sessions\": 4}"));
  assert.deepEqual(configured, { code: 3, started: ["a"] }, "the pool's configuration changed: it restarts to read it");
});

test("3.11 · with free slots and nothing ready, one planning session starts for a qualifying arc, never two at once", async (t) => {
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

test("3.25 · a dispatcher configured machineOnly starts only work tagged to its machine and never a planning lane, even with an arc to plan (ADR-1179 D2)", async (t) => {
  const arcs = [{ id: "arc_old", state: "active", title: "Old", created: "2026-10-01T00:00:00Z", openQuestions: 0 }];
  const work = poolWork(["any", "mine"]);
  work.increments[1].machine = "laptop";
  const b = await box(t, { survey: async () => ({ ...work, here: "laptop", arcs }), count: async () => 0, maxLanes: async () => 2 });
  b.env = { AGENT_POOL_CONFIG: join(b.lanesDir, "agent-pool.json") };
  await writeFile(b.env.AGENT_POOL_CONFIG, JSON.stringify({ machineOnly: true }));
  let looks = 0;
  b.sleep = async () => { await new Promise((go) => setImmediate(go)); if (++looks === 3) await writeFile(join(b.lanesDir, "pool-stop"), ""); };
  assert.equal(await main(["pool"], b), 0);
  assert.deepEqual(b.briefs.map((brief) => brief.split("\n")[0]), ["# Pool lane: mine"], "the laptop's own work, and no planning lane for the arc");
});

test("3.14 · an arc it planned in a state it remembers is not planned again after a restart, and is once that state changes", async (t) => {
  const arc = { id: "arc_owner", state: "active", title: "Owner", created: "2026-10-01T00:00:00Z", openQuestions: 0 };
  const waiting = (ids) => ({ ...poolWork(ids), increments: poolWork(ids).increments.map((one) => ({ ...one, arc: arc.id })), arcs: [arc], holds: { waits: {}, heldOn: {}, waitsFor: Object.fromEntries(ids.map((id) => [id, [{ releaser: "event", note: "Apple renews the certificate", holds: true }]])) } });
  const restart = async (b, work) => {
    const started = [];
    b.survey = async () => work;
    b.runLane = async (options) => { started.push((await readFile(options.brief, "utf8")).split("\n")[0]); return 0; };
    let looks = 0;
    b.sleep = async () => { await new Promise((go) => setImmediate(go)); if (++looks === 2) await writeFile(join(b.lanesDir, "pool-stop"), ""); };
    assert.equal(await main(["pool"], b), 0);
    await rm(join(b.lanesDir, "pool-stop"));
    return started;
  };
  const b = await box(t, { count: async () => 0, maxLanes: async () => 2 });
  assert.deepEqual(await restart(b, waiting(["cert"])), ["# Planning lane: arc_owner"]);
  assert.deepEqual(await restart(b, waiting(["cert"])), [], "restarted, with nothing changed on the arc: no second planning lane");
  assert.deepEqual(await restart(b, waiting(["cert", "next"])), ["# Planning lane: arc_owner"], "a newly parked increment changes it");
});

test("3.12 · an increment handed to the watcher is not offered while its hand-off stands, its fix session running or not", async (t) => {
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

test("3.13 · with free slots and nothing ready the dispatcher looks again within minutes; full slots poll, and a failing survey backs off", async () => {
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

test("3.17 · the dispatcher's cap is the configured session count, which the lanes folder's night-max-lanes overrides live", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "lane-pool-config-"));
  t.after(() => removeTemp(home));
  const config = join(home, "agent-pool.json"), lanes = join(home, "lanes");
  await mkdir(lanes);
  await writeFile(config, JSON.stringify({ lanes, sessions: 3 }));
  const slots = [];
  const box = { home, env: { AGENT_POOL_CONFIG: config }, count: async () => 1, out: (line) => slots.push(line) };
  assert.equal(await main(["slots"], box), 0);
  await writeFile(join(lanes, "night-max-lanes"), "7\n");
  assert.equal(await main(["slots"], box), 0);
  assert.deepEqual(slots, ["1 engines running, cap 3", "1 engines running, cap 7"]);
});

test("3.19 · `ready` prints, as JSON, the engines running, the cap, the lanes folder, the work the pool would start now, each with its arc's priority, and every arc it would plan with nothing ready, each with its state, for the project named", async (t) => {
  const b = await box(t, {
    maxLanes: async () => 4, count: async () => 2,
    survey: async (project) => {
      const work = poolWork(["increment_ranked", "increment_held", "increment_free"], { claims: [{ holder: "live", increment: "increment_held", session: "s1", since: "2026-10-08T00:00:00Z" }] });
      work.increments[0].priority = 1;
      for (const one of work.increments) one.title = `${project}: ${one.id}`;
      work.arcs = [
        { id: "arc_later", state: "active", title: "Later", created: "2026-10-02T00:00:00Z", openQuestions: 0 },
        { id: "arc_increment_free", state: "active", title: "Has ready work", created: "2026-10-01T00:00:00Z", openQuestions: 0 },
        { id: "arc_asked", state: "active", title: "Waits on a question", created: "2026-10-01T00:00:00Z", openQuestions: 1 },
        { id: "arc_first", state: "active", title: "First", created: "2026-10-01T00:00:00Z", openQuestions: 0 },
      ];
      return work;
    },
  });
  const out = [];
  b.out = (line) => out.push(line);
  assert.equal(await main(["ready", "x-twin-map-reads-on"], b), 0);
  assert.deepEqual(JSON.parse(out.join("\n")), {
    running: 2, cap: 4, lanesDir: b.lanesDir,
    ready: [
      { id: "increment_ranked", title: "x-twin-map-reads-on: increment_ranked", priority: 1 },
      { id: "increment_free", title: "x-twin-map-reads-on: increment_free" },
    ],
    plans: [
      { id: "arc_first", title: "First", state: "[0,[]]" },
      { id: "arc_later", title: "Later", state: "[0,[]]" },
    ],
  });
});

test("3.21 · `ready --drained` also lists, after the arcs it would plan, every arc drained of its work (closed, no question open) with its state; plain `ready` never does", async (t) => {
  const b = await box(t, {
    maxLanes: async () => 4, count: async () => 0,
    survey: async () => ({
      ...poolWork([]),
      arcs: [
        { id: "arc_drained", state: "closed", title: "Drained", created: "2026-10-01T00:00:00Z", openQuestions: 0 },
        { id: "arc_parked", state: "parked", title: "Parked", created: "2026-10-01T00:00:00Z", openQuestions: 0 },
        { id: "arc_active", state: "active", title: "Active", created: "2026-10-02T00:00:00Z", openQuestions: 0 },
      ],
    }),
  });
  const plans = async (args) => {
    const out = [];
    b.out = (line) => out.push(line);
    assert.equal(await main(args, b), 0);
    return JSON.parse(out.join("\n")).plans;
  };
  assert.deepEqual(await plans(["ready", "x-twin-map-reads-on", "--drained"]), [
    { id: "arc_active", title: "Active", state: "[0,[]]" },
    { id: "arc_drained", title: "Drained", state: "[0,[]]" },
  ]);
  assert.deepEqual(await plans(["ready", "x-twin-map-reads-on"]), [{ id: "arc_active", title: "Active", state: "[0,[]]" }]);
});

test("3.26 · on Windows the checkout lock is a lock file: a second holder waits for the first, a dead holder's file does not block, and a failing holder lets it go", async (t) => {
  const path = join(await folder(t), "night-checkout.lock");
  const order = [], alive = new Set([1, 2]);
  let release, entered;
  const inside = new Promise((go) => { entered = go; });
  const first = withLockFile(path, () => new Promise((go) => { order.push("first"); release = go; entered(); }), { pid: 1, alive: (pid) => alive.has(pid) });
  await inside;
  assert.equal((await readFile(path, "utf8")).trim(), "1", "the lock file names its holder");
  await withLockFile(path, async () => { order.push("second"); }, { pid: 2, alive: (pid) => alive.has(pid),
    sleep: async () => { order.push("wait"); release(); await first; } });
  assert.deepEqual(order, ["first", "wait", "second"]);
  await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" }, "the last holder removed it");
  await writeFile(path, "77\n");
  assert.equal(await withLockFile(path, async () => "ran", { pid: 3, alive: (pid) => pid !== 77, sleep: async () => assert.fail("a dead holder's lock blocked") }), "ran");
  await assert.rejects(withLockFile(path, async () => { throw new Error("prepare failed"); }, { pid: 3, alive: () => true }), /prepare failed/);
  await assert.rejects(readFile(path, "utf8"), { code: "ENOENT" }, "a failing holder lets it go");
});

test("3.26 · the lock file's own liveness check: a live holder, or one it may not signal, is waited on; a gone one's file is taken over", async (t) => {
  const path = join(await folder(t), "night-checkout.lock");
  const gone = spawn(process.execPath, ["-e", ""]);
  await new Promise((done) => gone.once("exit", done));
  // A system process this user may not signal: the System process on Windows, init elsewhere.
  for (const holder of [process.pid, process.platform === "win32" ? 4 : 1]) {
    await writeFile(path, `${holder}\n`);
    let waited = 0;
    const holding = withLockFile(path, async () => "ran", { pid: 3, sleep: async () => { waited += 1; await rm(path, { force: true }); } });
    assert.equal(await holding, "ran");
    assert.equal(waited, 1, `holder ${holder} is waited on`);
  }
  await writeFile(path, `${gone.pid}\n`);
  assert.equal(await withLockFile(path, async () => "ran", { pid: 3, sleep: async () => assert.fail("a gone holder's lock blocked") }), "ran");
});

test("3.26 · on Windows the checkout's pnpm install runs through a shell, since pnpm is a .cmd there; git never does, and on Linux nothing does", async () => {
  for (const platform of ["win32", "linux"]) {
    const calls = [];
    await prepareCheckout({ repo: "/repo", platform, exec: async (command, args, options) => { calls.push({ command, shell: options.shell === true }); return { stdout: PUSH_URL }; } });
    assert.deepEqual(calls.filter((call) => call.shell).map((call) => call.command), platform === "win32" ? ["pnpm"] : [], platform);
    assert.ok(calls.some((call) => call.command === "pnpm"));
  }
});

test("3.27 · the start rule holds a lane back on battery and while the library or GitHub does not answer; a machine with no battery is plugged in", async () => {
  const online = async () => true, offline = async () => false;
  assert.equal((await startHold({ power: async () => "Offline", online })).reason, "on battery: a lane starts only while the machine is plugged in");
  assert.equal((await startHold({ power: async () => "Online", online: offline })).reason, "offline: the library or GitHub does not answer");
  for (const line of ["Online", "Unknown", ""]) assert.equal(await startHold({ power: async () => line, online }), undefined, `power line ${line || "unread"}`);
  assert.equal(await startHold({ power: async () => { throw new Error("no powershell"); }, online }), undefined, "an unread power line holds nothing back");
  assert.equal((await startHold({ power: async () => "Offline", online: () => assert.fail("read online while on battery") })).windows[0], "power");
});

test("3.27 · a machine-only dispatcher on battery or offline starts nothing and says why once, then starts once plugged in and online; any other dispatcher never reads them", async (t) => {
  const work = poolWork(["mine"]);
  work.increments[0].machine = "laptop";
  let power = "Offline", online = false, looks = 0;
  const b = await box(t, { survey: async () => ({ ...work, here: "laptop" }), count: async () => 0, maxLanes: async () => 1,
    power: async () => power, online: async () => online });
  b.env = { AGENT_POOL_CONFIG: join(b.lanesDir, "agent-pool.json") };
  await writeFile(b.env.AGENT_POOL_CONFIG, JSON.stringify({ machineOnly: true }));
  b.sleep = async () => {
    await new Promise((go) => setImmediate(go));
    looks += 1;
    if (looks === 2) power = "Online";
    if (looks === 3) online = true;
    if (b.briefs.length) await writeFile(join(b.lanesDir, "pool-stop"), "");
  };
  assert.equal(await main(["pool"], b), 0);
  assert.deepEqual(b.briefs.map((brief) => brief.split("\n")[0]), ["# Pool lane: mine"]);
  const holds = b.lines.filter((line) => /holding back dispatch/.test(line)).map((line) => line.replace(/^\S+ /, ""));
  assert.deepEqual(holds, ["holding back dispatch: on battery: a lane starts only while the machine is plugged in",
    "holding back dispatch: offline: the library or GitHub does not answer"], "each said once, though on battery for two looks");
  assert.ok(b.lines.findIndex((line) => /offline/.test(line)) < b.lines.findIndex((line) => /start mine/.test(line)));

  const mint = await box(t, { survey: async () => poolWork(["any"]), count: async () => 0, maxLanes: async () => 1,
    power: () => assert.fail("the Mint pool read the power line"), online: () => assert.fail("the Mint pool probed the network") });
  mint.sleep = async () => { await new Promise((go) => setImmediate(go)); if (mint.briefs.length) await writeFile(join(mint.lanesDir, "pool-stop"), ""); };
  assert.equal(await main(["pool"], mint), 0);
  assert.equal(mint.briefs.length, 1);
});

test("3.28 · a dispatcher configured with its own checkout and lanes folder briefs its lanes with those folders, not the Mint box's", async (t) => {
  const b = await box(t, { survey: async () => poolWork(["one"]), count: async () => 0,
    rules: async () => "Work from ~/code/storytree03, never ~/code/storytree03-wt. Your report goes to ~/storytree-lanes/pool-<increment>.report.md.\n" });
  b.home = b.lanesDir;
  b.env = { AGENT_POOL_CONFIG: join(b.lanesDir, "agent-pool.json") };
  await writeFile(b.env.AGENT_POOL_CONFIG, JSON.stringify({ checkout: "C:/code/storytree03", lanes: "~/.storytree/agent-pool" }));
  delete b.briefPaths;
  b.sleep = async () => { await new Promise((go) => setImmediate(go)); if (b.briefs.length) await writeFile(join(b.lanesDir, "pool-stop"), ""); };
  assert.equal(await main(["pool"], b), 0);
  assert.ok(b.briefs[0].endsWith(`Work from C:/code/storytree03, never ~/code/storytree03-wt. Your report goes to ${join(b.lanesDir, ".storytree", "agent-pool")}/pool-<increment>.report.md.\n`), b.briefs[0]);
});

test("3.29 · a lane stopped by a signal leaves the pool running and its increment surveyed and started again; a lane exiting 75 still ends the pool", async () => {
  const lines = [], started = [];
  let looks = 0, stop = false;
  const code = await runPool({
    survey: async () => poolWork(["a"]), maxLanes: async () => 1, count: async () => 0,
    stopFile: "/lanes/pool-stop", exists: async () => stop, now, say: (line) => lines.push(line),
    launch: async (one) => { started.push(one.id); return started.length === 1 ? SIGNALED : 0; },
    sleep: async () => { looks += 1; await new Promise((go) => setImmediate(go)); if (started.length === 2 || looks > 20) stop = true; },
  });
  assert.equal(code, 0, "the pool ran on until its stop file");
  assert.deepEqual(started, ["a", "a"], "the signal-stopped increment was offered again at once, with no back-off");
  assert.ok(lines.some((line) => /stopped by a signal: requeued a/.test(line)), lines.join("\n"));

  const failing = await runPool({
    survey: async () => poolWork(["a", "b"]), maxLanes: async () => 1, count: async () => 0,
    stopFile: "/lanes/pool-stop", exists: async () => false, now, say: (line) => lines.push(line),
    launch: async () => 75, sleep: async () => { await new Promise((go) => setImmediate(go)); },
  });
  assert.equal(failing, 75);
  assert.match(lines.at(-1), /pool stopped: engine failing at once on a$/);
});

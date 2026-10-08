import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { main, prepareCheckout, PUSH_URL } from "./launch.mjs";

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
  const events = [], lines = [], briefs = [];
  const counts = [5, 4];
  return {
    lanesDir, events, lines, briefs, repo: join(lanesDir, "repo"), addDirs: ["/wt", lanesDir], pid: 4242, now,
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

test("12.2 · the mintlib queue stops on a failed lane, keeping it queued, and refuses to start without its common brief", async (t) => {
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

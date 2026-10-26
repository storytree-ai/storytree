import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { removeTemp } from "@storytree/test-waits";

import { loopsInside, main, slugOf } from "./reclone.mjs";

const run = promisify(execFile);
const git = async (args, cwd) => (await run("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd })).stdout.trim();

/** A file's text with Windows line endings read as plain ones: Git for Windows checks text out with CRLF. */
const text = async (path) => (await readFile(path, "utf8")).replace(/\r\n/g, "\n");

async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), "reclone-"));
  t.after(() => removeTemp(path));
  return path;
}

/** Two repositories (the old and the new), a checkout of the old one with a follow-main worktree outside it and a branch worktree inside it. */
async function machine(t) {
  const root = await folder(t);
  const repos = {};
  for (const name of ["old", "new"]) {
    const seed = join(root, `${name}-seed`);
    await mkdir(seed);
    await git(["init", "-q", "-b", "main"], seed);
    await writeFile(join(seed, "which.txt"), `${name}\n`);
    await git(["add", "."], seed);
    await git(["commit", "-q", "-m", `${name} start`], seed);
    repos[name] = join(root, `${name}.git`);
    await git(["clone", "-q", "--bare", seed, repos[name]], root);
  }
  const checkout = join(root, "storytree03"), follow = join(root, "lanes", "watch", "main");
  await git(["clone", "-q", repos.old, checkout], root);
  await git(["config", "remote.origin.pushurl", "git@github.com:someone/old.git"], checkout);
  await mkdir(join(root, "lanes", "watch"), { recursive: true });
  await git(["worktree", "add", "-q", "--lock", "--detach", follow, "origin/main"], checkout);
  await git(["worktree", "add", "-q", "-b", "lane", join(checkout, ".claude", "worktrees", "lane")], checkout);
  await writeFile(join(checkout, "local-only.txt"), "kept\n");
  return { root, repos, checkout, follow, lanes: join(root, "lanes") };
}

const NOW = () => Date.parse("2026-10-25T09:00:00Z");
const ASIDE = ".before-20261025T090000Z";

test("9.1 · the re-clone moves the old checkout and its follow-main worktrees aside, clones, installs, makes them again and checks the library; dry by default", async (t) => {
  const m = await machine(t);
  const did = [], lines = [];
  // The GitHub repository the URL names decides the push URL; the local bare repository stands in for it.
  const repo = m.repos.new;
  const x = {
    install: async (at) => { did.push(["install", at]); },
    check: async (at) => { did.push(["check", at]); return "library answers"; },
    forget: async (dir) => { did.push(["forget", dir]); return { prs: [3], to: join(dir, "before-x") }; },
    restartWatcher: async () => { did.push(["watcher"]); return "no watcher was running"; },
  };
  const box = { say: (line) => lines.push(line), now: NOW, x, lanesBeside: async () => [], runningInside: () => [], loopsInside: () => [], env: { LANES_DIR: m.lanes } };
  const args = ["--checkout", m.checkout, "--repo", repo, "--lanes", m.lanes];

  assert.equal(await main(args, box), 0);
  assert.equal(await text(join(m.checkout, "which.txt")), "old\n", "a dry run changes nothing");
  assert.deepEqual(did, []);
  assert.match(lines.join("\n"), /dry run/);

  // On the box it refuses until the pool is paused.
  lines.length = 0;
  assert.equal(await main([...args, "--apply"], box), 1);
  assert.match(lines.join("\n"), /refused: pause the pool first/);
  assert.equal(await text(join(m.checkout, "which.txt")), "old\n");

  await writeFile(join(m.lanes, "pool-stop"), "paused\n");
  // Nor while the dispatcher's loop still runs from the checkout: it would restart on the moved-aside code.
  lines.length = 0;
  assert.equal(await main([...args, "--apply"], { ...box, loopsInside: (at) => at === m.checkout ? ["77"] : [] }), 1);
  assert.match(lines.join("\n"), /refused: the dispatcher's loop still runs from .* \(77\)/);
  assert.equal(await text(join(m.checkout, "which.txt")), "old\n");
  lines.length = 0;
  assert.equal(await main([...args, "--apply"], box), 0, lines.join("\n"));
  const aside = `${m.checkout}${ASIDE}`;
  assert.equal(await text(join(aside, "local-only.txt")), "kept\n", "the old checkout is kept whole");
  assert.equal(await text(join(aside, ".claude", "worktrees", "lane", "which.txt")), "old\n", "with its worktrees");
  assert.equal(await git(["branch", "--show-current"], join(aside, ".claude", "worktrees", "lane")), "lane", "whose links to it still work");
  assert.ok(existsSync(join(`${m.follow}${ASIDE}`, "which.txt")), "the follow-main worktree is moved aside, not deleted");
  assert.equal(await text(join(m.checkout, "which.txt")), "new\n", "the checkout is a clone of the new repository");
  assert.equal(await text(join(m.follow, "which.txt")), "new\n", "the follow-main worktree is made again from it");
  assert.match(await git(["worktree", "list", "--porcelain"], m.checkout), /locked/, "locked, as it was");
  assert.ok(existsSync(join(m.checkout, ".claude", "worktrees")), "the lane worktree root is made");
  assert.equal(await git(["config", "--get", "remote.origin.pushurl"], m.checkout), repo, "it pushes where it clones from, as the old checkout pushed apart from its fetch URL");
  assert.deepEqual(did, [["install", m.checkout], ["forget", join(m.lanes, "watch")], ["watcher"], ["check", m.checkout]]);
  assert.match(lines.join("\n"), /set aside #3/);
  assert.match(lines.join("\n"), /old checkout is kept at .*before-20261025T090000Z/);
  assert.match(lines.join("\n"), /nothing still runs from the moved-aside checkout/);

  // A second re-clone in the same second would overwrite a moved-aside copy: refused, nothing moved.
  lines.length = 0;
  assert.equal(await main([...args, "--apply"], box), 1);
  assert.match(lines.join("\n"), /already exists: nothing moved/);
  assert.equal(await text(join(m.checkout, "which.txt")), "new\n");

  // A step that fails stops the rest and says why, in the command's own words.
  lines.length = 0;
  const failing = { ...box, now: () => NOW() + 1000, x: { ...x, install: async () => { throw Object.assign(new Error("Command failed: pnpm install"), { stderr: "ERR_PNPM_NO_PKG_MANIFEST No package.json found\n" }); } } };
  assert.equal(await main([...args, "--apply"], failing), 1);
  assert.match(lines.join("\n"), /failed: Command failed: pnpm install: ERR_PNPM_NO_PKG_MANIFEST No package.json found\nstopped at step 6;/);
  assert.doesNotMatch(lines.join("\n"), /check storytree/, "no step after it runs");
  assert.ok(existsSync(`${m.checkout}.before-20261025T090001Z`), "and what moved stays where it went");
});

test("9.1 · a checkout named by another path to the same folder (a link, or Windows' short name for its temp folder) still has the worktrees inside it moved and repaired", async (t) => {
  const m = await machine(t);
  const alias = join(await folder(t), "alias");
  await symlink(m.root, alias, "junction");
  const lines = [];
  const x = { install: async () => {}, check: async () => "" };
  const box = { say: (line) => lines.push(line), now: NOW, x, runningInside: () => [], env: { LANES_DIR: join(m.root, "no-lanes") } };
  assert.equal(await main(["--checkout", join(alias, "storytree03"), "--repo", m.repos.new, "--apply"], box), 0, lines.join("\n"));
  assert.equal(await git(["branch", "--show-current"], join(`${m.checkout}${ASIDE}`, ".claude", "worktrees", "lane")), "lane");
  assert.doesNotMatch(lines.join("\n"), /left on the moved-aside checkout/, "nor is the checkout itself or a worktree inside it read as one left outside it");
});

test("9.1 · a re-clone from GitHub pushes over SSH to the repository it cloned, and says what still runs from the moved-aside checkout", async (t) => {
  assert.equal(slugOf("https://github.com/storytree-ai/storytree.git"), "storytree-ai/storytree");
  assert.equal(slugOf("git@github.com:storytree-ai/storytree-flip-rehearsal.git"), "storytree-ai/storytree-flip-rehearsal");
  assert.throws(() => slugOf("https://example.com/a/b.git"), /not a GitHub repository URL/);
  const m = await machine(t);
  const lines = [], set = [];
  const x = {
    install: async () => {}, check: async () => "",
    // Only the push URL is read from the real clone; cloning GitHub is the stand-in's.
    git: async (args, cwd) => {
      if (args[0] === "clone") return (await run("git", ["clone", "-q", m.repos.new, args.at(-1)], { cwd })).stdout;
      if (args[0] === "config" && args[1] === "remote.origin.pushurl") set.push(args[2]);
      return (await run("git", args, { cwd })).stdout;
    },
  };
  const box = { say: (line) => lines.push(line), now: NOW, x, runningInside: () => ["4242"], env: { LANES_DIR: join(m.root, "no-lanes") } };
  assert.equal(await main(["--checkout", m.checkout, "--repo", "https://github.com/storytree-ai/storytree.git", "--apply"], box), 0, lines.join("\n"));
  assert.deepEqual(set, ["git@github.com:storytree-ai/storytree.git"]);
  assert.match(lines.join("\n"), /still running from the moved-aside checkout, to restart from the new one: 4242/);
  assert.doesNotMatch(lines.join("\n"), /watcher/, "with no lanes folder (the laptop) there is no watcher to carry");
});

test("9.1 · a re-clone from GitHub keeps the SSH host the old checkout pushed through, so a deploy key's alias survives it", async (t) => {
  const m = await machine(t);
  await git(["config", "remote.origin.pushurl", "git@github.com-storytree:storytree-ai/storytree-old.git"], m.checkout);
  const set = [], lines = [];
  const x = {
    install: async () => {}, check: async () => "",
    git: async (args, cwd) => {
      if (args[0] === "clone") return (await run("git", ["clone", "-q", m.repos.new, args.at(-1)], { cwd })).stdout;
      if (args[0] === "config" && args[1] === "remote.origin.pushurl") set.push(args[2]);
      return (await run("git", args, { cwd })).stdout;
    },
  };
  const box = { say: (line) => lines.push(line), now: NOW, x, runningInside: () => [], env: { LANES_DIR: join(m.root, "no-lanes") } };
  assert.equal(await main(["--checkout", m.checkout, "--repo", "https://github.com/storytree-ai/storytree.git", "--apply"], box), 0, lines.join("\n"));
  assert.deepEqual(set, ["git@github.com-storytree:storytree-ai/storytree.git"]);
});

test("9.1 · the dispatcher's loops running inside a checkout are found by their folder and command line, and nothing else is", { skip: process.platform === "win32" && "platform:posix: the box reads /proc, and Windows makes no symlink without privilege" }, async (t) => {
  const root = await folder(t), checkout = join(root, "storytree03"), proc = join(root, "proc");
  await mkdir(join(checkout, "packages"), { recursive: true });
  const at = async (pid, cwd, cmdline) => {
    await mkdir(join(proc, pid), { recursive: true });
    await symlink(cwd, join(proc, pid, "cwd"));
    if (cmdline !== undefined) await writeFile(join(proc, pid, "cmdline"), cmdline.split(" ").join("\0"));
  };
  await at("77", checkout, "bash /home/u/storytree-lanes/launch-pool.sh run");
  await at("78", join(checkout, "packages"), "node voice-commit.ts");
  await at("79", root, "bash /home/u/storytree-lanes/launch-pool.sh run");
  await at("80", checkout);
  assert.deepEqual(loopsInside(checkout, proc), ["77"]);
});

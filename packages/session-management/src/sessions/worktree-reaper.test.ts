/**
 * Capability 4 · Sessions, contract 4.18: the hooks reap a merged worktree once every session that
 * worked in it has left (ADR-0790), on a real git repository and the real activity log on the
 * Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { connect } from "@storytree/library";
import { start } from "@storytree/local-postgres";
import { waitUntil } from "@storytree/test-waits";

import { openActivityLog } from "../activity/index.js";
import { claim, release } from "../claims/index.js";
import { git, withTempDir } from "@storytree/project-and-caller/testing/folders";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { closeOut, readSessions, reapWorktrees } from "./index.js";
import { setUpWorktree } from "../claims/worktree-setup.js";
import { EMPTY_TRASH } from "./worktree-reaper.js";
import { gitWithin } from "./worktree-leftovers.js";

test("4.12, 4.18 a new admitted claim reopens a closed-out session and keeps its fresh worktree before any edit; a later close-out permits reaping", async () => {
  const storytree = await connect({ url: testServerUrl() });
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    const library = await storytree.openProject(project);
    const arc = await library.createArc({ title: "Continue work", intent: "Build the next piece", endState: "Both pieces landed" });
    const increment = await library.addIncrement({ arc: arc.id, title: "Next piece", objective: "Continue after close-out", body: "Claim a fresh workspace" });
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      git(repo, "commit", "-q", "--allow-empty", "-m", "first");
      const home = path.join(dir, "ledger");
      mkdirSync(home);
      const who = { log, library, project, session: "continuing", harness: "codex", folder: repo, branch: "main" };
      const session = async () => (await readSessions(log, project)).find((one) => one.session === who.session)!;
      await closeOut(who, { safe: true, why: "Previous work finished" }, { home });
      assert.equal((await session()).closeOut?.verified, true);
      assert.equal((await session()).listing, "hidden");

      const folder = path.join(dir, "next");
      const branch = "codex/next";
      git(repo, "worktree", "add", "-q", "-b", branch, folder, "main");
      const next = { ...who, folder, branch };
      assert.equal((await claim(next, increment.id, "Build the next piece")).ok, true);
      // A fresh branch is already in main: branch resolution must not mask the stale close-out.
      const observer = { log, project, session: "observer", harness: "codex", folder: repo, source: "hook" } as const;
      await log.append(project, { session: observer.session, source: "hook", kind: "branch-state", of: branch, open: false, how: "not-ahead" });
      const watch = { everyMs: 0, budgetMs: 60_000, protect: [], empty: (trash: string) => rmSync(trash, { recursive: true, force: true }) };
      assert.deepEqual(await reapWorktrees(observer, watch), [], "the fresh claimed worktree stays before any edit");
      assert.equal(existsSync(folder), true);
      assert.equal(git(repo, "branch", "--list", "--format=%(refname:short)", branch).trim(), branch);
      const reopened = await session();
      assert.equal(reopened.closeOut, undefined);
      assert.equal(reopened.listing, "listed");
      assert.equal(reopened.state, "working");

      assert.equal((await release(next, increment.id)).ok, true);
      await closeOut(next, { safe: true, why: "Next work finished, nothing left running" }, { home });
      assert.equal((await session()).closeOut?.verified, true);
      assert.deepEqual(await reapWorktrees(observer, watch), [folder]);
      assert.equal(existsSync(folder), false);
      assert.equal(git(repo, "branch", "--list", branch).trim(), "");
    });
  } finally {
    await log.close();
    await storytree.close();
    await dropTestProjects([project]);
  }
});

test("4.18 a clean worktree whose head is in main, and whose sessions have all closed out or been archived, is removed with its branch; a dirty, unmerged, locked, unknown, still-used, protected or hook-running one stays", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      writeFileSync(path.join(repo, "a.txt"), "a\n");
      writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
      git(repo, "add", "a.txt", ".gitignore");
      git(repo, "commit", "-q", "-m", "first");
      const trees = path.join(repo, ".claude", "worktrees");
      const tree = (name: string) => {
        git(repo, "worktree", "add", "-q", "-b", `claude/${name}`, path.join(trees, name), "main");
        return path.join(trees, name);
      };
      const [merged, archived, dirty, ahead, locked, unknown, used, guarded, running] =
        ["merged", "archived", "dirty", "ahead", "locked", "unknown", "used", "guarded", "running"].map(tree) as [string, string, string, string, string, string, string, string, string];
      writeFileSync(path.join(dirty, "stray.txt"), "not committed\n");
      writeFileSync(path.join(ahead, "b.txt"), "b\n");
      git(ahead, "add", "b.txt");
      git(ahead, "commit", "-q", "-m", "work");
      git(repo, "worktree", "lock", locked);
      mkdirSync(path.join(merged, "node_modules", "deep"), { recursive: true });
      writeFileSync(path.join(merged, "node_modules", "deep", "x.js"), "");

      const here = { harness: "claude-code", source: "hook", machine: "here" } as const;
      const left = async (session: string, folder: string, how: "closed-out" | "archived") => {
        const branch = `claude/${path.basename(folder)}`;
        await log.append(project, { ...here, session, folder: path.join(folder, "packages"), branch, kind: "file-edited", files: ["x.ts"] });
        await log.append(project, { ...here, session: "observer", folder: repo, kind: "branch-state", of: branch, open: false, how: "not-ahead" });
        if (how === "closed-out") await log.append(project, { ...here, session, folder, branch, kind: "closed-out", safe: true, why: "merged", running: 0 });
        else await log.append(project, { ...here, session: "observer", folder: repo, kind: "session-archived", of: session, app: "claude-desktop" });
      };
      await left("s-merged", merged, "closed-out");
      await left("s-archived", archived, "archived");
      await left("s-dirty", dirty, "closed-out");
      await left("s-ahead", ahead, "archived");
      await left("s-locked", locked, "closed-out");
      await left("s-guarded", guarded, "closed-out");
      await left("s-running", running, "closed-out");
      // One session left the worktree, but another still works in it.
      await left("s-used", used, "closed-out");
      await log.append(project, { ...here, session: "s-still", folder: used, branch: "claude/used", kind: "file-edited", files: ["y.ts"] });

      const emptied: string[] = [];
      const reaped = await reapWorktrees(
        { log, project, folder: running, session: "observer", harness: "claude-code", source: "hook" },
        { everyMs: 0, budgetMs: 60_000, protect: [path.join(guarded, "packages", "session-management", "dist", "storytree-hook.mjs")], empty: (trash) => { emptied.push(trash); rmSync(trash, { recursive: true, force: true }); } },
      );

      assert.deepEqual([...reaped].sort(), [archived, merged].sort());
      for (const gone of [archived, merged]) assert.equal(existsSync(gone), false, `${gone} is deleted`);
      for (const kept of [dirty, ahead, locked, unknown, used, guarded, running]) assert.equal(existsSync(kept), true, `${kept} stays`);
      const listed = git(repo, "worktree", "list", "--porcelain");
      assert.equal(listed.includes("/merged\n"), false, "unregistered");
      assert.equal(listed.includes("/archived\n"), false, "unregistered");
      const branches = git(repo, "branch", "--format=%(refname:short)").split("\n");
      assert.equal(branches.includes("claude/merged"), false, "its merged branch is deleted");
      assert.equal(branches.includes("claude/ahead"), true);
      assert.equal(emptied.length, 1, "the trash is handed on to be emptied once");
    });
  } finally {
    await log.close();
  }
});

test("4.18 a merged worktree is compared with origin/main when the clone has no origin/HEAD and its local main is behind", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      git(repo, "commit", "-q", "--allow-empty", "-m", "first");
      git(dir, "init", "-q", "--bare", "-b", "main", path.join(dir, "origin.git"));
      git(repo, "remote", "add", "origin", path.join(dir, "origin.git"));
      git(repo, "push", "-q", "origin", "main");
      const folder = path.join(repo, ".claude", "worktrees", "landed");
      git(repo, "worktree", "add", "-q", "-b", "claude/landed", folder, "main");
      git(folder, "commit", "-q", "--allow-empty", "-m", "work");
      git(folder, "push", "-q", "origin", "HEAD:main");
      assert.throws(() => git(repo, "rev-parse", "--abbrev-ref", "origin/HEAD"), "no origin/HEAD in this clone");

      const here = { harness: "claude-code", source: "hook", machine: "here" } as const;
      await log.append(project, { ...here, session: "s-landed", folder, branch: "claude/landed", kind: "file-edited", files: ["x.ts"] });
      await log.append(project, { ...here, session: "observer", folder: repo, kind: "branch-state", of: "claude/landed", open: false, how: "not-ahead" });
      await log.append(project, { ...here, session: "s-landed", folder, branch: "claude/landed", kind: "closed-out", safe: true, why: "merged", running: 0 });
      const watch = { everyMs: 0, budgetMs: 60_000, protect: [], empty: (trash: string) => rmSync(trash, { recursive: true, force: true }) };
      assert.deepEqual(await reapWorktrees({ log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" }, watch), [folder]);
      assert.equal(existsSync(folder), false);
    });
  } finally {
    await log.close();
  }
});

test("4.37 a worktree reaped while a test Postgres still runs on its .pgtest/data has that server stopped and the folder removed", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      writeFileSync(path.join(repo, ".gitignore"), ".pgtest/\n");
      git(repo, "add", ".gitignore");
      git(repo, "commit", "-q", "-m", "first");
      const folder = path.join(repo, ".claude", "worktrees", "tested");
      git(repo, "worktree", "add", "-q", "-b", "claude/tested", folder, "main");
      // A run whose harness was killed outright leaves its server running, never stopped.
      const server = await start({ dataDir: path.join(folder, ".pgtest", "data"), serverLog: path.join(dir, "pg.log"), toolLog: path.join(dir, "tools.log") });
      try {
        const pid = Number(readFileSync(path.join(server.dataDir, "postmaster.pid"), "utf8").split("\n")[0]);
        const here = { harness: "claude-code", source: "hook", machine: "here" } as const;
        await log.append(project, { ...here, session: "s-tested", folder, branch: "claude/tested", kind: "file-edited", files: ["x.ts"] });
        await log.append(project, { ...here, session: "observer", folder: repo, kind: "branch-state", of: "claude/tested", open: false, how: "not-ahead" });
        await log.append(project, { ...here, session: "s-tested", folder, branch: "claude/tested", kind: "closed-out", safe: true, why: "merged", running: 0 });
        const watch = { everyMs: 0, budgetMs: 60_000, protect: [], empty: (trash: string) => rmSync(trash, { recursive: true, force: true }) };
        assert.deepEqual(await reapWorktrees({ log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" }, watch), [folder]);
        assert.equal(existsSync(folder), false);
        assert.throws(() => process.kill(pid, 0), "the server is stopped");
      } finally {
        await server.stop();
      }
    });
  } finally {
    await log.close();
  }
});

test("4.37 a worktree whose folder cannot be renamed for a moment after its test Postgres stops, as Windows releases a killed server's handles late, is still removed", { skip: process.platform === "win32" && "platform:posix: a read-only parent folder does not stop a rename on Windows" }, async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      writeFileSync(path.join(repo, ".gitignore"), ".pgtest/\n");
      git(repo, "add", ".gitignore");
      git(repo, "commit", "-q", "-m", "first");
      const trees = path.join(repo, ".claude", "worktrees");
      const folder = path.join(trees, "released-late");
      git(repo, "worktree", "add", "-q", "-b", "claude/released-late", folder, "main");
      const server = await start({ dataDir: path.join(folder, ".pgtest", "data"), serverLog: path.join(dir, "pg.log"), toolLog: path.join(dir, "tools.log") });
      // Held as a killed server's handles hold it: no rename until a moment after the server stops.
      chmodSync(trees, 0o555);
      let release: NodeJS.Timeout | undefined;
      try {
        const here = { harness: "claude-code", source: "hook", machine: "here" } as const;
        await log.append(project, { ...here, session: "s-late", folder, branch: "claude/released-late", kind: "file-edited", files: ["x.ts"] });
        await log.append(project, { ...here, session: "observer", folder: repo, kind: "branch-state", of: "claude/released-late", open: false, how: "not-ahead" });
        await log.append(project, { ...here, session: "s-late", folder, branch: "claude/released-late", kind: "closed-out", safe: true, why: "merged", running: 0 });
        const watch = { everyMs: 0, budgetMs: 60_000, protect: [], empty: (trash: string) => rmSync(trash, { recursive: true, force: true }) };
        release = setTimeout(() => chmodSync(trees, 0o755), 400);
        assert.deepEqual(await reapWorktrees({ log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" }, watch), [folder]);
        assert.equal(existsSync(folder), false);
      } finally {
        clearTimeout(release);
        chmodSync(trees, 0o755);
        await server.stop();
      }
    });
  } finally {
    await log.close();
  }
});

test("4.36 a folder under .claude/worktrees that git no longer lists goes once idle if git has all its content, its links removed and never followed; one holding content git lacks, one a live process works in, or one a session wrote in lately stays", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const repo = path.join(dir, "site");
    git(dir, "init", "-q", "-b", "main", repo);
    writeFileSync(path.join(repo, "a.txt"), "a\n");
    writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n.claude/\n");
    git(repo, "add", "a.txt", ".gitignore");
    git(repo, "commit", "-q", "-m", "first");
    const trees = path.join(repo, ".claude", "worktrees");
    // A removal that failed on long paths: git no longer lists it, and its checkout is still there.
    const orphan = path.join(trees, "orphan");
    git(repo, "worktree", "add", "-q", "-b", "claude/orphan", orphan, "main");
    rmSync(path.join(orphan, ".git"));
    git(repo, "worktree", "prune");
    const store = path.join(dir, "store", "pkg");
    mkdirSync(store, { recursive: true });
    writeFileSync(path.join(store, "index.js"), "kept\n");
    mkdirSync(path.join(orphan, "node_modules"));
    writeFileSync(path.join(orphan, "node_modules", "built.js"), "generated\n");
    symlinkSync(store, path.join(orphan, "node_modules", "pkg"), "junction");
    const folder = (name: string, files: Record<string, string>) => {
      mkdirSync(path.join(trees, name), { recursive: true });
      for (const [file, text] of Object.entries(files)) writeFileSync(path.join(trees, name, file), text);
      return path.join(trees, name);
    };
    const empty = folder("empty", {});
    const unique = folder("unique", { "a.txt": "a\n", "notes.txt": "only here\n" });
    const used = folder("used", { "a.txt": "a\n" });
    const recent = folder("recent", { "a.txt": "a\n" });
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60_000);
    for (const one of [orphan, empty, unique, used, recent]) utimesSync(one, twoDaysAgo, twoDaysAgo);
    await log.append(project, { harness: "claude-code", source: "hook", machine: "here", session: "s-recent", folder: recent, branch: "main", kind: "file-edited", files: ["a.txt"] });
    const user = spawn(process.execPath, ["-e", "console.log('ready'); setInterval(() => {}, 1000)"], { cwd: used, stdio: ["ignore", "pipe", "ignore"] });
    try {
      await new Promise((resolve) => user.stdout.once("data", resolve));
      // The trash is emptied by the script the detached process runs, here in the foreground.
      const emptyNow = (trash: string) => execFileSync(process.execPath, ["-e", EMPTY_TRASH, trash]);
      const reaped = await reapWorktrees({ log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" }, { everyMs: 0, budgetMs: 60_000, protect: [], empty: emptyNow });
      assert.deepEqual([...reaped].sort(), [empty, orphan].sort());
      for (const gone of [empty, orphan]) assert.equal(existsSync(gone), false, `${gone} is deleted`);
      for (const kept of [unique, used, recent]) assert.equal(existsSync(kept), true, `${kept} stays`);
      assert.equal(existsSync(path.join(repo, ".git", "storytree-reaped")), false, "the trash is emptied, the link with it");
      assert.equal(existsSync(path.join(store, "index.js")), true, "the link's target is untouched");
    } finally {
      user.kill();
      await new Promise((resolve) => (user.exitCode === null && user.signalCode === null ? user.once("exit", resolve) : resolve(undefined)));
      await log.close();
    }
  });
});

test("19.4 · a worktree set up from the local file that names teardown commands has them run in it, in order, by a process of their own once the reaper would remove it, and is removed on a later pass once they have finished, a failed one included; a worktree never set up runs none", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      writeFileSync(path.join(repo, "a.txt"), "a\n");
      git(repo, "add", "a.txt");
      git(repo, "commit", "-q", "-m", "first");
      const said = path.join(dir, "torn-down.txt");
      mkdirSync(path.join(repo, ".storytree"));
      writeFileSync(path.join(repo, ".git", "info", "exclude"), ".storytree/\n");
      const record = (word: string) => `node -e "require('fs').appendFileSync(${JSON.stringify(said).replace(/"/g, "'")}, '${word} ' + require('path').basename(process.cwd()) + '\\n')"`;
      writeFileSync(path.join(repo, ".storytree", "worktree.local.json"), JSON.stringify({ teardown: [record("first"), "node -e \"process.exit(4)\"", record("then")] }));
      const here = { harness: "claude-code", source: "hook", machine: "here" } as const;
      const tree = async (name: string) => {
        const folder = path.join(dir, name);
        git(repo, "worktree", "add", "-q", "-b", `claude/${name}`, folder, "main");
        await log.append(project, { ...here, session: `s-${name}`, folder, branch: `claude/${name}`, kind: "file-edited", files: ["x.ts"] });
        await log.append(project, { ...here, session: "observer", folder: repo, kind: "branch-state", of: `claude/${name}`, open: false, how: "not-ahead" });
        await log.append(project, { ...here, session: `s-${name}`, folder, branch: `claude/${name}`, kind: "closed-out", safe: true, why: "merged", running: 0 });
        return folder;
      };
      const setUp = await tree("set-up");
      assert.deepEqual(setUpWorktree(repo, setUp)?.steps, [], "setting up runs no teardown");
      const plain = await tree("plain");
      assert.equal(existsSync(said), false);

      const observer = { log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" } as const;
      const watch = { everyMs: 0, budgetMs: 60_000, protect: [], empty: (trash: string) => rmSync(trash, { recursive: true, force: true }) };
      assert.deepEqual(await reapWorktrees(observer, watch), [plain], "one never set up goes at once");
      assert.equal(existsSync(setUp), true, "one set up stays while its teardown runs");
      const reaped = await waitUntil(async () => { const gone = await reapWorktrees(observer, watch); return gone.length > 0 ? gone : undefined; }, 20_000, "the set-up worktree to be reaped after its teardown");
      assert.deepEqual(reaped, [setUp], "it goes once its teardown has finished");
      assert.equal(existsSync(setUp), false);
      assert.equal(readFileSync(said, "utf8"), "first set-up\nthen set-up\n", "each command ran in the worktree, in order, past a failed one, and only there");
    });
  } finally {
    await log.close();
  }
});

test("19.4 · a set-up worktree whose teardown marker is read mid-write, empty between its truncation and its write, stays for a later pass (regression: reaped mid-teardown on CI's own-health run, 2026-11-02)", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      git(repo, "commit", "-q", "--allow-empty", "-m", "first");
      mkdirSync(path.join(repo, ".storytree"));
      writeFileSync(path.join(repo, ".git", "info", "exclude"), ".storytree/\n");
      writeFileSync(path.join(repo, ".storytree", "worktree.local.json"), JSON.stringify({ teardown: ["node -e \"\""] }));
      const folder = path.join(dir, "set-up");
      git(repo, "worktree", "add", "-q", "-b", "claude/set-up", folder, "main");
      const here = { harness: "claude-code", source: "hook", machine: "here" } as const;
      await log.append(project, { ...here, session: "s-set-up", folder, branch: "claude/set-up", kind: "file-edited", files: ["x.ts"] });
      await log.append(project, { ...here, session: "observer", folder: repo, kind: "branch-state", of: "claude/set-up", open: false, how: "not-ahead" });
      await log.append(project, { ...here, session: "s-set-up", folder, branch: "claude/set-up", kind: "closed-out", safe: true, why: "merged", running: 0 });
      assert.deepEqual(setUpWorktree(repo, folder)?.steps, []);
      const mark = path.join(path.resolve(folder, git(folder, "rev-parse", "--git-dir").trim()), "storytree-setup.json");
      assert.equal(existsSync(mark), true);

      writeFileSync(mark, "");
      const observer = { log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" } as const;
      const watch = { everyMs: 0, budgetMs: 60_000, protect: [], empty: (trash: string) => rmSync(trash, { recursive: true, force: true }) };
      assert.deepEqual(await reapWorktrees(observer, watch), [], "a marker caught mid-write keeps the worktree");
      assert.equal(existsSync(folder), true);

      writeFileSync(mark, JSON.stringify({ teardown: ["node -e \"\""], started: { at: Date.now() }, ran: [] }));
      assert.deepEqual(await reapWorktrees(observer, watch), [folder], "once it reads whole and done, it goes");
    });
  } finally {
    await log.close();
  }
});

test("3.46 the look the hooks hand on runs git with the repository's own commands off: reaping a merged worktree, and reading which folders git still lists, starts neither its file-system monitor nor its hooks", async () => {
  const log = await openActivityLog(testServerUrl());
  const project = uniqueProjectName();
  try {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "site");
      git(dir, "init", "-q", "-b", "main", repo);
      git(repo, "commit", "-q", "--allow-empty", "-m", "first");
      const folder = path.join(repo, ".claude", "worktrees", "landed");
      git(repo, "worktree", "add", "-q", "-b", "claude/landed", folder, "main");
      // The repository's own config names a monitor and a folder of hooks; each leaves a line when git starts it.
      const marker = path.join(dir, "ran").replace(/\\/g, "/");
      const hooks = path.join(dir, "repo-hooks");
      mkdirSync(hooks);
      for (const hook of ["post-checkout", "reference-transaction", "post-index-change"]) {
        writeFileSync(path.join(hooks, hook), `#!/bin/sh\necho ${hook} >> '${marker}'\n`);
        chmodSync(path.join(hooks, hook), 0o755);
      }
      git(repo, "config", "core.hooksPath", hooks);
      git(repo, "config", "core.fsmonitor", `echo fsmonitor >> '${marker}'`);

      const here = { harness: "claude-code", source: "hook", machine: "here" } as const;
      await log.append(project, { ...here, session: "s-landed", folder, branch: "claude/landed", kind: "file-edited", files: ["x.ts"] });
      await log.append(project, { ...here, session: "observer", folder: repo, kind: "branch-state", of: "claude/landed", open: false, how: "not-ahead" });
      await log.append(project, { ...here, session: "s-landed", folder, branch: "claude/landed", kind: "closed-out", safe: true, why: "merged", running: 0 });
      const watch = { everyMs: 0, budgetMs: 60_000, protect: [], empty: (trash: string) => rmSync(trash, { recursive: true, force: true }) };
      assert.deepEqual(await reapWorktrees({ log, project, folder: repo, session: "observer", harness: "claude-code", source: "hook" }, watch), [folder]);
      assert.equal(git(repo, "branch", "--list", "claude/landed").trim(), "", "its branch is deleted");
      assert.equal(gitWithin(60_000)(repo, ["status", "--porcelain"]), "", "the leftovers read finds the checkout clean");
      assert.equal(existsSync(marker), false, existsSync(marker) ? readFileSync(marker, "utf8") : "");
    });
  } finally {
    await log.close();
  }
});

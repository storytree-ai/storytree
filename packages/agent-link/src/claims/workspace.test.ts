/**
 * Capability 5 · Claims, a workspace already claimed (ADR-0653, the owner's K1): one test per
 * contract 5.12-5.14 in stories/agent-link.md, against the real Postgres `pnpm test` provides and
 * real git. Each test clones a throwaway repository whose origin gains a commit after the clone, so
 * a workspace cut from the clone's own, stale view of main would show it.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { connect, type Library } from "@storytree/library";

import { openActivityLog, type ActivityLog } from "../activity/index.js";
import { git, withTempDir } from "../testing/folders.js";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "../testing/pg.js";
import { claim, makeWorkspace, readClaims, type ClaimContext } from "./index.js";

interface World {
  dir: string;
  log: ActivityLog;
  library: Library;
  project: string;
  /** The clone the sessions work in, one commit behind its origin's main. */
  site: string;
  /** The commit origin's main is at: a workspace must start from it. */
  fresh: string;
  /** A proposed increment on a fresh arc. */
  park(title: string): Promise<string>;
  /** Session A (Claude Code), or B (Codex), working in `folder` (by default, the clone). */
  as(session: "A" | "B", folder?: string): ClaimContext & { folder: string };
}

async function withWorld(body: (world: World) => Promise<void>): Promise<void> {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const origin = path.join(dir, "origin.git");
    const seed = path.join(dir, "seed");
    const site = path.join(dir, "site");
    git(dir, "init", "--bare", "-b", "main", origin);
    mkdirSync(seed);
    git(seed, "init", "-b", "main");
    writeFileSync(path.join(seed, "README.md"), "site\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "first");
    git(seed, "remote", "add", "origin", origin);
    git(seed, "push", "origin", "main");
    git(dir, "clone", origin, site);
    writeFileSync(path.join(seed, "NEWS.md"), "after the clone\n");
    git(seed, "add", ".");
    git(seed, "commit", "-m", "second");
    git(seed, "push", "origin", "main");
    const fresh = git(seed, "rev-parse", "HEAD").trim();

    const storytree = await connect({ url: testServerUrl() });
    const log = await openActivityLog(testServerUrl());
    try {
      const library = await storytree.openProject(project);
      const arc = await library.createArc({ title: "Launch v1", intent: "Ship sign-up", endState: "Visitors sign up" });
      const harnessOf = { A: "claude-code", B: "codex" } as const;
      await body({
        dir,
        log,
        library,
        project,
        site,
        fresh,
        park: async (title) => (await library.addIncrement({ arc: arc.id, title, objective: `Build ${title}`, body: `${title}, red then green` })).id,
        as: (session, folder = site) => ({ log, library, project, session, harness: harnessOf[session], folder }),
      });
    } finally {
      try {
        await log.close();
        await storytree.close();
      } finally {
        await dropTestProjects([project]);
      }
    }
  });
}

/** The worktrees git has for the repository `folder` is in. */
function worktrees(folder: string): string[] {
  return git(folder, "worktree", "list", "--porcelain")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length)));
}

/** The branches of the repository `folder` is in. */
function branches(folder: string): string[] {
  return git(folder, "branch", "--format=%(refname:short)").split(/\r?\n/).filter((line) => line !== "");
}

async function statusOf(library: Library, increment: string): Promise<string | undefined> {
  const { arcs } = await library.projectTree();
  for (const arc of arcs) {
    const found = (await library.arcView(arc.id))?.increments.find((one) => one.id === increment);
    if (found !== undefined) return found.fields.status;
  }
  return undefined;
}

test("5.12 session A makes a workspace for a proposed increment: a new folder where its harness keeps worktrees, on a fresh branch cut from origin's main as just fetched, and A holds the increment there, the claim naming that branch, and the increment is active", async () => {
  await withWorld(async ({ dir, log, library, project, site, fresh, park, as }) => {
    const increment = await park("email form");

    const made = await makeWorkspace(as("A"), increment, "building the email form");

    assert.ok(made.ok, JSON.stringify(made));
    assert.equal(path.dirname(made.folder), path.join(site, ".claude", "worktrees"), "where Claude Code keeps its worktrees");
    assert.ok(existsSync(path.join(made.folder, "NEWS.md")), "cut from origin's main as just fetched, not the clone's stale view");
    assert.equal(git(made.folder, "rev-parse", "HEAD").trim(), fresh);
    assert.equal(git(made.folder, "rev-parse", "--abbrev-ref", "HEAD").trim(), made.branch);
    assert.match(made.branch, /^claude\//);
    assert.ok(worktrees(site).includes(path.resolve(made.folder)), "git knows it as a worktree, as the harness's own would be");
    assert.deepEqual(
      (await readClaims(log, project)).map(({ increment, session, reason, branch }) => ({ increment, session, reason, branch })),
      [{ increment, session: "A", reason: "building the email form", branch: made.branch }],
    );
    assert.equal(await statusOf(library, increment), "active");

    // Codex's workspace goes where Codex keeps its own, on a branch named for it.
    const other = await park("welcome email");
    const codexHome = path.join(dir, "codex-home");
    const codexMade = await makeWorkspace(as("B"), other, "sending the welcome email", { codexHome });
    assert.ok(codexMade.ok, JSON.stringify(codexMade));
    assert.equal(path.dirname(path.dirname(codexMade.folder)), path.join(codexHome, "worktrees"));
    assert.equal(path.basename(codexMade.folder), "site");
    assert.match(codexMade.branch, /^codex\//);
    assert.equal(git(codexMade.folder, "rev-parse", "HEAD").trim(), fresh);
  });
});

test("5.13 making a workspace for work another live session holds, or for waiting work, is refused naming the holder or the blocker, and no folder, branch or line is made; for work the session already holds it is refused naming the branch it holds it on", async () => {
  await withWorld(async ({ log, library, project, site, park, as }) => {
    const form = await park("email form");
    const confirm = await park("confirmation email");
    await library.addWait(confirm, form, "it sends what the form collects");
    assert.equal((await claim({ ...as("B"), branch: "codex/form" }, form, "wiring the form")).ok, true);
    const lines = (await log.since(project, 0)).lines.length;

    const held = await makeWorkspace(as("A"), form, "building the email form");
    assert.ok(!held.ok && held.refused === "held" && held.holder.session === "B", JSON.stringify(held));

    const waiting = await makeWorkspace(as("A"), confirm, "sending the confirmation");
    assert.ok(!waiting.ok && waiting.refused === "waiting", JSON.stringify(waiting));
    assert.deepEqual(waiting.waits.map(({ on, reason }) => ({ on, reason })), [{ on: form, reason: "it sends what the form collects" }]);

    assert.deepEqual(worktrees(site), [path.resolve(site)], "no workspace was made");
    assert.deepEqual(branches(site), ["main"], "no branch was made");
    assert.equal((await log.since(project, 0)).lines.length, lines, "nothing was written");
    assert.equal(await statusOf(library, confirm), "proposal", "not started");

    const mine = await makeWorkspace(as("B"), form, "again");
    assert.ok(!mine.ok && mine.refused === "yours" && mine.claim.branch === "codex/form", JSON.stringify(mine));
    assert.deepEqual(worktrees(site), [path.resolve(site)]);
  });
});

test("5.14 when main cannot be fetched fresh, as from a folder with no origin, it is refused saying why, and nothing is claimed or started", async () => {
  await withWorld(async ({ dir, log, library, project, park, as }) => {
    const alone = path.join(dir, "alone");
    mkdirSync(alone);
    git(alone, "init", "-b", "main");
    writeFileSync(path.join(alone, "README.md"), "alone\n");
    git(alone, "add", ".");
    git(alone, "commit", "-m", "first");
    const increment = await park("email form");

    const refused = await makeWorkspace(as("A", alone), increment, "building the email form");

    assert.ok(!refused.ok && refused.refused === "no-workspace", JSON.stringify(refused));
    assert.match(refused.why, /origin/);
    assert.deepEqual(await readClaims(log, project), []);
    assert.equal(await statusOf(library, increment), "proposal");
    assert.deepEqual(branches(alone), ["main"]);
  });
});

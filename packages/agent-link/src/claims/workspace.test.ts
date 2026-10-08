/**
 * Capability 5 · Claims, a workspace already claimed (ADR-0653, the owner's K1): one test per
 * contract 5.12-5.14 in the agent link story, against the real Postgres `pnpm test` provides and
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
import { readSessions } from "../sessions/index.js";
import { claim, makeWorkspace, readClaims, release, type ClaimContext } from "./index.js";
import * as workspace from "./workspace.js";

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
  await withWorld(async ({ log, library, project, site, fresh, park, as }) => {
    const increment = await park("email form");

    const made = await makeWorkspace(as("A"), increment, "building the email form");

    assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
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


  });
});

test("5.19 making a workspace for a capability from inside a worktree whose branch this session holds work on claims the capability there, on that branch, and makes no second worktree or branch", async () => {
  await withWorld(async ({ log, library, project, site, park, as }) => {
    const story = await library.addStory({ title: "Visitor can sign up" });
    const form = (await library.addCapability({ title: "Email form", story: story.id })).id;
    const made = await makeWorkspace(as("A"), await park("email form"), "building the email form");
    assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
    const [before, branchesBefore] = [worktrees(site), branches(site)];

    const here = await makeWorkspace(as("A", made.folder), form, "building the form");

    assert.ok(here.ok && here.status === "ready", JSON.stringify(here));
    assert.equal(here.existing, true);
    assert.equal(path.resolve(here.folder), path.resolve(made.folder));
    assert.equal(here.branch, made.branch);
    assert.deepEqual(worktrees(site), before, "git worktree list is unchanged");
    assert.deepEqual(branches(site), branchesBefore, "no branch is cut");
    const claimed = (await readClaims(log, project)).find((one) => one.capability === form);
    assert.deepEqual({ session: claimed?.session, branch: claimed?.branch }, { session: "A", branch: made.branch });

    // Session B holds nothing on that branch: its call is prepared a workspace of its own, as before.
    const reset = (await library.addCapability({ title: "Password reset", story: story.id })).id;
    const other = await makeWorkspace(as("B", made.folder), reset, "building the reset");
    assert.ok(other.ok && other.status === "prepared", JSON.stringify(other));
  });
});

test("5.19 asking for a workspace for an available increment from inside a linked worktree, named or detached, from a subfolder, in either harness, is refused with the command that claims it there, and nothing is fetched, made, prepared, claimed or started; held work is still refused as held", async () => {
  await withWorld(async ({ dir, log, library, project, site, park, as }) => {
    const increment = await park("email form");
    const named = path.join(dir, "named");
    const detached = path.join(dir, "detached");
    git(site, "worktree", "add", "-b", "claude/older", named, "main");
    git(site, "worktree", "add", "--detach", detached, "main");
    const subfolder = path.join(named, "deep");
    mkdirSync(subfolder);
    const [before, branchesBefore, seen] = [worktrees(site), branches(site), git(site, "rev-parse", "refs/remotes/origin/main").trim()];

    for (const [session, folder] of [["A", named], ["A", detached], ["A", subfolder], ["B", named], ["B", detached]] as const) {
      const refused = await makeWorkspace(as(session, folder), increment, "build form");

      assert.ok(!refused.ok && refused.refused === "no-workspace", `${session} in ${folder}: ${JSON.stringify(refused)}`);
      assert.match(refused.why, new RegExp(`storytree workspace claim ${increment}`));
      assert.deepEqual(worktrees(site), before, "no worktree is made");
      assert.deepEqual(branches(site), branchesBefore, "no branch is cut");
      assert.equal(git(site, "rev-parse", "refs/remotes/origin/main").trim(), seen, "main is not fetched");
      assert.deepEqual(await readClaims(log, project), [], "nothing is claimed");
      assert.equal(await statusOf(library, increment), "proposal", "not started");
    }

    assert.equal((await claim({ ...as("B"), branch: "codex/form" }, increment, "wiring the form")).ok, true);
    const held = await makeWorkspace(as("A", named), increment, "build form");
    assert.ok(!held.ok && held.refused === "held", JSON.stringify(held));
  });
});

test("4.22 a workspace made from the main checkout places its branch under the workspace's folder, not the main checkout's (regression, 2026-10-02: the main checkout labelled unmerged)", async () => {
  await withWorld(async ({ log, project, site, park, as }) => {
    await log.append(project, { session: "A", harness: "claude-code", source: "hook", folder: site, branch: "main", kind: "session-started", how: "startup" });
    const made = await makeWorkspace(as("A"), await park("email form"), "building the email form");
    assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
    const [session] = await readSessions(log, project);
    assert.deepEqual(session?.branchesByFolder.map(({ folder, branch }) => ({ folder, branch })), [{ folder: made.folder, branch: made.branch }]);
  });
});

test("5.13 making a workspace for work another live session holds, or for waiting work, is refused naming the holder or the blocker, and no folder, branch or claim is made, only a claim-refused line for the held work; for work the session already holds it is refused naming the branch it holds it on", async () => {
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
    assert.deepEqual((await log.since(project, 0)).lines.slice(lines).map((line) => line.kind === "claim-refused" ? [line.session, line.increment, line.holder] : line.kind),
      [["A", form, "B"]], "only the refusal of held work was written");
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


test("5.12 Codex prepares without creating or claiming, then attaches the app's detached or named worktree at the pinned fresh commit", async () => {
  await withWorld(async ({ dir, log, library, project, site, fresh, park, as }) => {
    for (const detached of [true, false]) {
      const increment = await park(detached ? "detached form" : "named form");
      const before = await readClaims(log, project);
      const prepared = await makeWorkspace(as("B"), increment, "build form");
      assert.ok(prepared.ok && prepared.status === "prepared", JSON.stringify(prepared));
      assert.equal(prepared.ref, fresh);
      assert.equal(prepared.base, "origin/main");
      assert.match(prepared.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(prepared.name.startsWith(increment.replace(/[^a-z0-9-]+/g, "-").slice(0, 32)));
      assert.deepEqual(await readClaims(log, project), before);
      assert.equal(await statusOf(library, increment), "proposal");
      assert.equal(worktrees(site).length, detached ? 1 : 2, "preparation made no worktree");

      const folder = path.join(dir, detached ? "app detached" : "app named");
      const branch = detached ? `codex/${prepared.name}` : "codex/app-chosen";
      git(site, "worktree", "add", ...(detached ? ["--detach"] : ["-b", branch]), folder, prepared.ref);
      // The expected commit is the prepared SHA, even if another fetch moves the remote ref.
      git(site, "update-ref", "refs/remotes/origin/main", git(site, "rev-parse", "main").trim());
      const attached = await workspace.attachWorkspace(as("B"), increment, "build form", { folder, ref: prepared.ref, name: prepared.name });
      assert.ok(attached.ok, JSON.stringify(attached));
      assert.equal(attached.folder, folder);
      assert.equal(attached.branch, branch);
      assert.equal(git(folder, "rev-parse", "HEAD").trim(), fresh);
      assert.equal(git(folder, "symbolic-ref", "--short", "HEAD").trim(), branch);
      const held = (await readClaims(log, project)).find((c) => c.increment === increment);
      assert.equal(held?.session, "B");
      assert.equal(held?.branch, branch);
      assert.equal(await statusOf(library, increment), "active");
    }
  });
});

test("5.13 Codex checks held, waiting and already-owned work before creation, and refuses a claim lost before attachment without changing the app worktree, recording only each refusal of held work", async () => {
  await withWorld(async ({ dir, log, library, project, site, park, as }) => {
    const increment = await park("email form");
    const waiting = await park("confirmation");
    await library.addWait(waiting, increment, "needs the form");
    const prepared = await makeWorkspace(as("B"), increment, "build form");
    assert.ok(prepared.ok && prepared.status === "prepared", JSON.stringify(prepared));
    const folder = path.join(dir, "app-worktree");
    git(site, "worktree", "add", "--detach", folder, prepared.ref);
    await claim({ ...as("A"), branch: "claude/winner" }, increment, "won the race");
    const lines = (await log.since(project, 0)).lines.length;
    const held = await makeWorkspace(as("B"), increment, "again");
    assert.ok(!held.ok && held.refused === "held");
    const blocked = await makeWorkspace(as("B"), waiting, "send confirmation");
    assert.ok(!blocked.ok && blocked.refused === "waiting");
    const yours = await makeWorkspace({ ...as("A"), harness: "codex" }, increment, "again");
    assert.ok(!yours.ok && yours.refused === "yours" && yours.claim.branch === "claude/winner");

    const refused = await workspace.attachWorkspace(as("B"), increment, "build form", { folder, ref: prepared.ref, name: prepared.name });
    assert.ok(!refused.ok && refused.refused === "held" && refused.holder.session === "A", JSON.stringify(refused));
    assert.equal(git(folder, "rev-parse", "--abbrev-ref", "HEAD").trim(), "HEAD");
    assert.deepEqual(branches(site), ["main"]);
    assert.ok(existsSync(folder));
    assert.deepEqual((await log.since(project, 0)).lines.slice(lines).map((line) => line.kind === "claim-refused" ? [line.session, line.increment, line.holder] : line.kind),
      [["B", increment, "A"], ["B", increment, "A"]]);
    assert.equal((await readClaims(log, project))[0]?.session, "A");
  });
});

test("5.14 Codex refuses invalid returned directories and releases a claim if naming the branch fails, keeping the app worktree", async () => {
  await withWorld(async ({ dir, log, library, project, site, park, as }) => {
    const increment = await park("email form");
    const prepared = await makeWorkspace(as("B"), increment, "build form");
    assert.ok(prepared.ok && prepared.status === "prepared", JSON.stringify(prepared));
    const folder = path.join(dir, "app-worktree");
    git(site, "worktree", "add", "--detach", folder, prepared.ref);
    const subfolder = path.join(folder, "nested");
    mkdirSync(subfolder);
    const foreign = path.join(dir, "foreign");
    git(dir, "clone", site, foreign);
    const foreignWorktree = path.join(dir, "foreign-worktree");
    git(foreign, "worktree", "add", "--detach", foreignWorktree, prepared.ref);
    const stale = path.join(dir, "stale");
    git(site, "worktree", "add", "--detach", stale, "main");
    for (const badFolder of [foreignWorktree, site, subfolder, stale]) {
      const refused = await workspace.attachWorkspace(as("B"), increment, "build form", { folder: badFolder, ref: prepared.ref, name: prepared.name });
      assert.ok(!refused.ok && refused.refused === "no-workspace", JSON.stringify(refused));
      assert.deepEqual(await readClaims(log, project), []);
      assert.equal(await statusOf(library, increment), "proposal");
      assert.ok(existsSync(badFolder));
    }
    git(site, "branch", `codex/${prepared.name}`, prepared.ref);
    const failed = await workspace.attachWorkspace(as("B"), increment, "build form", { folder, ref: prepared.ref, name: prepared.name });
    assert.ok(!failed.ok && failed.refused === "no-workspace", JSON.stringify(failed));
    assert.deepEqual(await readClaims(log, project), []);
    assert.deepEqual((await log.since(project, 0)).lines.filter((line) => line.kind === "claimed" || line.kind === "released").map((line) => line.kind), ["claimed", "released"]);
    assert.equal(git(folder, "rev-parse", "--abbrev-ref", "HEAD").trim(), "HEAD");
    assert.ok(existsSync(folder));
    assert.equal(await statusOf(library, increment), "active");
  });
});

test("5.13 a claim taken by this session during attachment is refused as already yours and never released or retargeted", async () => {
  await withWorld(async ({ dir, log, project, site, park, as }) => {
    const increment = await park("email form");
    const prepared = await makeWorkspace(as("B"), increment, "build form");
    assert.ok(prepared.ok && prepared.status === "prepared", JSON.stringify(prepared));
    const folder = path.join(dir, "app-worktree");
    git(site, "worktree", "add", "--detach", folder, prepared.ref);
    const branch = `codex/${prepared.name}`;
    // The other call wins after preflight but immediately before attachment's atomic claim.
    const locked = log.locked.bind(log);
    log.locked = async (project, work) => {
      log.locked = locked;
      await claim({ ...as("B"), branch }, increment, "the other call");
      return locked(project, work);
    };
    const refused = await workspace.attachWorkspace(as("B"), increment, "build form", { folder, ref: prepared.ref, name: prepared.name });
    assert.ok(!refused.ok && refused.refused === "yours", JSON.stringify(refused));
    const [held] = await readClaims(log, project);
    assert.equal(held?.branch, branch);
    assert.equal(held?.reason, "the other call");
    assert.equal(git(folder, "rev-parse", "--abbrev-ref", "HEAD").trim(), "HEAD");
  });
});

test("5.13 a session that holds work on a branch GitHub reports merged, before the merge watch has run, gets a fresh workspace instead of being pointed at the merged branch", async () => {
  await withWorld(async ({ log, project, park, as }) => {
    const increment = await park("email form");
    assert.equal((await claim({ ...as("A"), branch: "claude/landed" }, increment, "first unit")).ok, true);
    const mergedPulls = async (_folder: string, branch: string) => branch === "claude/landed" ? [{ number: 7, mergedAt: new Date(Date.now() + 1_000).toISOString() }] : [];

    const made = await makeWorkspace(as("A"), increment, "next unit", { mergedPulls });

    assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
    assert.notEqual(made.branch, "claude/landed");
    assert.deepEqual((await readClaims(log, project)).map(({ session, branch }) => ({ session, branch })), [{ session: "A", branch: made.branch }]);
  });
});

test("5.13 a session that holds work on a branch whose pull request waits in the merge queue gets a fresh workspace on a new branch, and still holds the work there", async () => {
  await withWorld(async ({ log, project, park, as }) => {
    const increment = await park("email form");
    assert.equal((await claim({ ...as("A"), branch: "claude/queued" }, increment, "first unit")).ok, true);
    const queuedPulls = async (_folder: string, branch: string) => branch === "claude/queued" ? [9] : [];

    const made = await makeWorkspace(as("A"), increment, "next unit", { mergedPulls: async () => [], queuedPulls });

    assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
    assert.notEqual(made.branch, "claude/queued");
    assert.deepEqual((await readClaims(log, project)).map(({ session, increment, branch }) => ({ session, increment, branch })), [{ session: "A", increment, branch: made.branch }]);
  });
});

test("5.12 a Claude Code session the app started in its own linked worktree attaches that folder: it holds the work on that worktree's branch, and no second worktree is made", async () => {
  await withWorld(async ({ dir, log, library, project, site, park, as }) => {
    const increment = await park("email form");
    const folder = path.join(dir, "app-made");
    git(site, "worktree", "add", "-b", "claude/app-made", folder, "main");

    const attached = await workspace.attachWorkspace(as("A", folder), increment, "build form", { folder });

    assert.ok(attached.ok, JSON.stringify(attached));
    assert.equal(attached.folder, folder);
    assert.equal(attached.branch, "claude/app-made");
    assert.deepEqual(worktrees(site), [path.resolve(site), path.resolve(folder)], "no second worktree");
    assert.deepEqual((await readClaims(log, project)).map(({ session, branch }) => ({ session, branch })), [{ session: "A", branch: "claude/app-made" }]);
    assert.equal(await statusOf(library, increment), "active");
  });
});

test("5.25 making a workspace for work that already has an open pull request is refused naming it, before anything is claimed or made, unless the session says to build beside it; a GitHub that cannot be asked refuses nothing", async () => {
  await withWorld(async ({ log, project, site, park, as }) => {
    const increment = await park("email form");
    const stem = increment.replace(/_/g, "-");
    const pull = (number: number) => ({ number, draft: false, queued: false });
    const allOpenPulls = async () => new Map([[`codex/${stem}-a1b2c3`, pull(716)], ["claude/increment-other-d4e5f6", pull(700)]]);

    const refused = await makeWorkspace(as("A"), increment, "build form", { allOpenPulls });

    assert.equal(refused.ok, false, JSON.stringify(refused));
    assert.ok(!refused.ok && refused.refused === "no-workspace");
    assert.deepEqual(refused.openPulls, [{ number: 716, branch: `codex/${stem}-a1b2c3` }], "the pulls are data, not only wording");
    assert.match(refused.why, /#716/);
    assert.match(refused.why, new RegExp(`codex/${stem}-a1b2c3`));
    assert.doesNotMatch(refused.why, /#700/);
    assert.deepEqual(await readClaims(log, project), [], "nothing claimed");
    assert.deepEqual(worktrees(site), [path.resolve(site)], "no worktree made");

    const beside = await makeWorkspace(as("A"), increment, "build form", { allOpenPulls }, { despiteOpenPulls: true });
    assert.ok(beside.ok && beside.status === "ready", JSON.stringify(beside));
    await release(as("A"), increment);

    const unasked = await makeWorkspace(as("A"), increment, "build form", { allOpenPulls: async () => undefined });
    assert.ok(unasked.ok && unasked.status === "ready", JSON.stringify(unasked));
  });
});

/**
 * Capability 5 · Claims, a workspace already claimed (ADR-0653, the owner's K1): one test per
 * contract 5.12-5.14 in the Session management story, against the real Postgres `pnpm test` provides and
 * real git. Each test clones a throwaway repository whose origin gains a commit after the clone, so
 * a workspace cut from the clone's own, stale view of main would show it.
 */
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { connect, type Library } from "@storytree/library";

import { openActivityLog, type ActivityLog } from "../activity/index.js";
import { git, withTempDir } from "@storytree/project-and-caller/testing/folders";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
import { readSessions } from "../sessions/index.js";
import { claim, makeWorkspace, readClaims, release, type ClaimContext } from "./index.js";
import * as workspace from "./workspace.js";
import { sessionTools, type ToolCall } from "../tools.js";
import { WORKSPACE_FAMILIES } from "./verbs.js";
import { teardownState } from "./worktree-setup.js";
import { readSetupApproval, setSetupApproval } from "@storytree/project-and-caller";
import type { DoorWords } from "@storytree/library/verbs";

const WORDS: DoorWords = { door: "command", say: (step) => step.command === undefined ? step.tool! : `storytree ${step.command}` };

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

test("5.12 making a workspace runs git with the repository's own commands off: the worktree is made and claimed, and neither its file-system monitor nor its hooks start", async () => {
  await withWorld(async ({ dir, log, project, site, fresh, park, as }) => {
    const increment = await park("quiet form");
    const marker = path.join(dir, "ran").replace(/\\/g, "/");
    const hooks = path.join(dir, "repo-hooks");
    mkdirSync(hooks);
    for (const hook of ["post-checkout", "reference-transaction", "post-index-change"]) {
      writeFileSync(path.join(hooks, hook), `#!/bin/sh\necho ${hook} >> '${marker}'\n`);
      chmodSync(path.join(hooks, hook), 0o755);
    }
    git(site, "config", "core.hooksPath", hooks);
    git(site, "config", "core.fsmonitor", `echo fsmonitor >> '${marker}'`);

    const made = await makeWorkspace(as("A"), increment, "building the quiet form");

    assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
    assert.equal(git(made.folder, "rev-parse", "HEAD").trim(), fresh);
    assert.deepEqual((await readClaims(log, project)).map(({ increment }) => increment), [increment]);
    assert.equal(existsSync(marker), false, existsSync(marker) ? readFileSync(marker, "utf8") : "");
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

test("5.13 making a workspace for work another live session holds, or for waiting work, is refused naming the holder or the blocker, and no folder, branch or claim is made, only a claim-refused line for the held work; for work the session already holds on a live worktree's branch it is refused naming that branch", async () => {
  await withWorld(async ({ dir, log, library, project, site, park, as }) => {
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

    const live = path.join(dir, "codex-form");
    git(site, "worktree", "add", "-b", "codex/form", live, "main");
    const mine = await makeWorkspace(as("B"), form, "again");
    assert.ok(!mine.ok && mine.refused === "yours" && mine.claim.branch === "codex/form", JSON.stringify(mine));
    assert.deepEqual(worktrees(site), [path.resolve(site), path.resolve(live)]);
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

test("5.13 Codex checks held and waiting work before creation, and refuses a claim lost before attachment without changing the app worktree, recording only each refusal of held work", async () => {
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
    assert.equal(await statusOf(library, increment), "proposal", "the released claim leaves it nobody's work: a proposal again (5.29)");
  });
});

test("5.59 a workspace for an increment claims every capability on its list with it, all or nothing; a listed capability another live session holds, before main is fetched or in the moment before the claim, refuses it naming that capability and its holder, leaving no worktree, branch or claim, and a claim-refused line under the increment", async () => {
  await withWorld(async ({ dir, log, library, project, site, park, as }) => {
    const story = await library.addStory({ title: "Visitor can sign up" });
    const capability = async (title: string) => (await library.addCapability({ title, story: story.id })).id;
    const [form, mail, page, button, banner] = [await capability("Form"), await capability("Mail"), await capability("Page"), await capability("Button"), await capability("Banner")];
    const arc = (await library.createArc({ title: "Wide", intent: "Many parts", endState: "All built" })).id;
    const wide = async (title: string, capabilities: string[]) => (await library.addIncrement({ arc, title, objective: title, body: title, capabilities })).id;
    const refusedUnder = async (from: number) => (await log.since(project, 0)).lines.slice(from)
      .filter((line) => line.kind === "claim-refused").map((line) => [line.session, line.capability, line.under, line.holder]);
    const mine = async (session: string) => (await readClaims(log, project)).filter((one) => one.session === session);

    // Free: the increment and both listed capabilities, on the new branch.
    const both = await wide("form and mail", [mail, form]);
    const made = await makeWorkspace(as("A"), both, "form and mail");
    assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
    assert.deepEqual((await mine("A")).map((one) => [one.increment ?? one.capability, one.branch]).sort(),
      [[both, made.branch], [form, made.branch], [mail, made.branch]].sort());
    const trees = worktrees(site);
    const branchesNow = branches(site);

    // Held before the call: refused before anything is fetched, claimed or made.
    assert.equal((await claim({ ...as("B"), branch: "codex/page" }, page, "the page")).ok, true);
    const standing = await wide("page and button", [button, page]);
    let from = (await log.since(project, 0)).lines.length;
    const held = await makeWorkspace(as("A"), standing, "page and button");
    assert.ok(!held.ok && held.refused === "held" && held.holder.session === "B" && "listed" in held && held.listed === page, JSON.stringify(held));
    assert.deepEqual(await refusedUnder(from), [["A", page, standing, "B"]]);
    assert.equal(await statusOf(library, standing), "proposal", "not started");

    // Taken in the moment between the check and the claim: the increment claim is let go again.
    const raced = await wide("banner", [banner]);
    const locked = log.locked.bind(log);
    log.locked = async (project, work) => {
      log.locked = locked;
      await claim({ ...as("B"), branch: "codex/banner" }, banner, "the banner");
      return locked(project, work);
    };
    from = (await log.since(project, 0)).lines.length;
    const lost = await makeWorkspace(as("A"), raced, "banner");
    assert.ok(!lost.ok && lost.refused === "held" && "listed" in lost && lost.listed === banner, JSON.stringify(lost));
    assert.deepEqual(await refusedUnder(from), [["A", banner, raced, "B"]]);
    assert.deepEqual(worktrees(site), trees, "no worktree was made");
    assert.deepEqual(branches(site), branchesNow, "no branch was made");
    assert.deepEqual((await mine("A")).map((one) => one.increment ?? one.capability).sort(), [both, form, mail].sort(), "nothing else is held");
    assert.equal(await statusOf(library, raced), "proposal", "the released claim leaves it a proposal");

    // Codex: a listed capability taken after preparation refuses the attachment, and the app's worktree is left as it was.
    const codex = await wide("button", [button]);
    const prepared = await makeWorkspace(as("B"), codex, "button");
    assert.ok(prepared.ok && prepared.status === "prepared", JSON.stringify(prepared));
    const folder = path.join(dir, "app-worktree");
    git(site, "worktree", "add", "--detach", folder, prepared.ref);
    await release(as("A"), both);
    assert.equal((await claim({ ...as("A"), branch: "claude/button" }, button, "the button")).ok, true);
    const attached = await workspace.attachWorkspace(as("B"), codex, "button", { folder, ref: prepared.ref, name: prepared.name });
    assert.ok(!attached.ok && attached.refused === "held" && "listed" in attached && attached.listed === button, JSON.stringify(attached));
    assert.equal(git(folder, "rev-parse", "--abbrev-ref", "HEAD").trim(), "HEAD");
    assert.deepEqual((await mine("B")).map((one) => one.increment ?? one.capability).sort(), [banner, page].sort());
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

test("5.13 a Claude Code session that holds work on the main checkout's branch gets a fresh workspace, and its claim moves onto the new branch without ever being released; held on a live worktree's branch it is still refused", async () => {
  await withWorld(async ({ log, project, site, park, as }) => {
    const increment = await park("email form");
    assert.equal((await claim({ ...as("A"), branch: "main" }, increment, "claimed from the main checkout")).ok, true);
    const lines = (await log.since(project, 0)).lines.length;

    const made = await makeWorkspace(as("A"), increment, "building the email form", { mergedPulls: async () => [], queuedPulls: async () => [] });

    assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
    assert.ok(worktrees(site).includes(path.resolve(made.folder)));
    assert.deepEqual((await readClaims(log, project)).map(({ session, increment, branch }) => ({ session, increment, branch })), [{ session: "A", increment, branch: made.branch }]);
    assert.deepEqual((await log.since(project, 0)).lines.slice(lines).filter((line) => line.kind === "released"), [], "no moment releases it");

    const again = await makeWorkspace(as("A", made.folder), increment, "again", { mergedPulls: async () => [], queuedPulls: async () => [] });
    assert.ok(!again.ok && again.refused === "yours" && again.claim.branch === made.branch, JSON.stringify(again));
    const fromMain = await makeWorkspace(as("A"), increment, "again", { mergedPulls: async () => [], queuedPulls: async () => [] });
    assert.ok(!fromMain.ok && fromMain.refused === "yours" && fromMain.claim.branch === made.branch, JSON.stringify(fromMain));
  });
});

test("5.13 a Codex session that holds work on the main checkout's branch has its workspace prepared and attached, and its claim moves onto the attached branch without ever being released; if attaching fails it goes back", async () => {
  await withWorld(async ({ dir, log, project, site, park, as }) => {
    const watch = { mergedPulls: async () => [], queuedPulls: async () => [], allOpenPulls: async () => new Map() };
    const increment = await park("email form");
    assert.equal((await claim({ ...as("B"), branch: "main" }, increment, "claimed from the main checkout")).ok, true);
    const lines = (await log.since(project, 0)).lines.length;

    const prepared = await makeWorkspace(as("B"), increment, "building the email form", watch);
    assert.ok(prepared.ok && prepared.status === "prepared", JSON.stringify(prepared));
    const broken = path.join(dir, "broken-worktree");
    git(site, "worktree", "add", "--detach", broken, prepared.ref);
    git(site, "branch", `codex/${prepared.name}`, prepared.ref);
    const failed = await workspace.attachWorkspace(as("B"), increment, "building the email form", { folder: broken, ref: prepared.ref, name: prepared.name }, watch);
    assert.ok(!failed.ok && failed.refused === "no-workspace", JSON.stringify(failed));
    assert.deepEqual((await readClaims(log, project)).map(({ session, branch }) => ({ session, branch })), [{ session: "B", branch: "main" }]);
    git(site, "branch", "-D", `codex/${prepared.name}`);

    const folder = path.join(dir, "app-worktree");
    git(site, "worktree", "add", "--detach", folder, prepared.ref);
    const attached = await workspace.attachWorkspace(as("B"), increment, "building the email form", { folder, ref: prepared.ref, name: prepared.name }, watch);

    assert.ok(attached.ok, JSON.stringify(attached));
    assert.deepEqual((await readClaims(log, project)).map(({ session, increment, branch }) => ({ session, increment, branch })), [{ session: "B", increment, branch: attached.branch }]);
    assert.deepEqual((await log.since(project, 0)).lines.slice(lines).filter((line) => line.kind === "released"), [], "no moment releases it");
    const again = await makeWorkspace(as("B"), increment, "again", watch);
    assert.ok(!again.ok && again.refused === "yours" && again.claim.branch === attached.branch, JSON.stringify(again));
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

test("5.47 a worktree git makes while printing to stderr is made and claimed; one git fails to make after its progress line is refused with git's own error, and leaves no claim, folder or branch behind", async () => {
  await withWorld(async ({ log, project, site, park, as }) => {
    const increment = await park("email form");

    const made = await makeWorkspace(as("A"), increment, "building the email form");

    assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
    assert.ok(worktrees(site).includes(path.resolve(made.folder)));
    assert.deepEqual((await readClaims(log, project)).map(({ increment, branch }) => ({ increment, branch })), [{ increment, branch: made.branch }]);

    // Git prints its progress line, makes the branch, then cannot keep the new worktree's records where they go.
    renameSync(path.join(site, ".git", "worktrees"), path.join(site, ".git", "worktrees-aside"));
    writeFileSync(path.join(site, ".git", "worktrees"), "not a folder\n");
    const reset = await park("password reset");
    const [before, branchesBefore] = [worktrees(site), branches(site)];

    const refused = await makeWorkspace(as("A"), reset, "building the reset");

    assert.ok(!refused.ok && refused.refused === "no-workspace", JSON.stringify(refused));
    assert.match(refused.why, /fatal: could not create leading directories/);
    assert.doesNotMatch(refused.why, /Preparing worktree/);
    assert.deepEqual(worktrees(site), before, "the half-made worktree is removed");
    assert.deepEqual(branches(site), branchesBefore, "its branch is deleted");
    assert.deepEqual((await readClaims(log, project)).map(({ increment }) => increment), [increment]);
  });
});

test("5.48 a session claiming again, from a linked worktree, work it holds on another branch holds it on that worktree's branch from then on; claiming it again from the main checkout leaves it there", async () => {
  await withWorld(async ({ dir, log, project, site, park, as }) => {
    const increment = await park("email form");
    assert.equal((await claim({ ...as("A"), branch: "main" }, increment, "claimed from the main checkout")).ok, true);
    const folder = path.join(dir, "by-hand");
    git(site, "worktree", "add", "-b", "claude/by-hand", folder, "origin/main");

    const again = await claim({ ...as("A", folder), branch: "claude/by-hand" }, increment, "claimed again in its worktree");

    assert.ok(again.ok && again.alreadyHeld !== true, JSON.stringify(again));
    assert.deepEqual((await readClaims(log, project)).map(({ session, branch }) => ({ session, branch })), [{ session: "A", branch: "claude/by-hand" }]);
    const fromMain = await claim({ ...as("A"), branch: "main" }, increment, "claimed from the main checkout");
    assert.ok(fromMain.ok && fromMain.alreadyHeld === true, JSON.stringify(fromMain));
    assert.deepEqual((await readClaims(log, project)).map(({ branch }) => branch), ["claude/by-hand"]);
  });
});

/** Write the project's local setup file in the main checkout `site`, and have git ignore `ignored` there. */
function localSetup(site: string, setup: unknown, ignored: readonly string[] = []): void {
  mkdirSync(path.join(site, ".storytree"), { recursive: true });
  writeFileSync(path.join(site, ".storytree", "worktree.local.json"), typeof setup === "string" ? setup : JSON.stringify(setup));
  writeFileSync(path.join(site, ".git", "info", "exclude"), [".storytree/", ...ignored].join("\n") + "\n");
}

test("19.1 · a workspace made in a project whose untracked `.storytree/worktree.local.json` names setup commands, files to copy and folders to share runs each command in the new worktree, copies each file or folder from the main checkout and shares each folder, and its answer reports each step", async () => {
  await withWorld(async ({ site, park, as }) => {
    writeFileSync(path.join(site, ".env"), "SECRET=1\n");
    mkdirSync(path.join(site, "config", "local"), { recursive: true });
    writeFileSync(path.join(site, "config", "local", "keys.txt"), "keys\n");
    mkdirSync(path.join(site, "models"));
    writeFileSync(path.join(site, "models", "big.bin"), "weights\n");
    localSetup(site, { copy: [".env", "config/local"], share: ["models"], setup: ["node -e \"require('fs').writeFileSync('installed.txt', require('fs').readFileSync('.env', 'utf8'))\""] }, [".env", "config/local/", "models/", "installed.txt"]);

    const made = await makeWorkspace(as("A"), await park("email form"), "building the email form");

    assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
    assert.equal(readFileSync(path.join(made.folder, ".env"), "utf8"), "SECRET=1\n", "the file is copied");
    assert.equal(readFileSync(path.join(made.folder, "config", "local", "keys.txt"), "utf8"), "keys\n", "the folder is copied");
    assert.equal(realpathSync(path.join(made.folder, "models")), realpathSync(path.join(site, "models")), "the folder is shared, not copied");
    assert.equal(readFileSync(path.join(made.folder, "installed.txt"), "utf8"), "SECRET=1\n", "the command ran in the worktree, after the copies");
    assert.deepEqual(made.setup, {
      file: ".storytree/worktree.local.json",
      steps: [
        { kind: "copy", what: ".env", ok: true },
        { kind: "copy", what: "config/local", ok: true },
        { kind: "share", what: "models", ok: true },
        { kind: "run", what: "node -e \"require('fs').writeFileSync('installed.txt', require('fs').readFileSync('.env', 'utf8'))\"", ok: true },
      ],
    });
  });
});

test("19.2 · a setup step that fails (a command exiting non-zero, a path with `..`, an absolute path or a link leading out of the repository, a path git does not ignore, a missing source, a copy over the cap, or a local file git tracks or cannot parse) is reported naming why, the rest still run, and the claim and the worktree are kept", async () => {
  await withWorld(async ({ dir, log, project, site, park, as }) => {
    writeFileSync(path.join(dir, "outside.txt"), "not the repository's\n");
    mkdirSync(path.join(dir, "outside"));
    symlinkSync(path.join(dir, "outside"), path.join(site, "escape"), "junction");
    writeFileSync(path.join(site, "plain.txt"), "not ignored\n");
    writeFileSync(path.join(site, "huge.bin"), Buffer.alloc(100));
    localSetup(site, {
      copy: ["../outside.txt", path.join(dir, "outside.txt"), "escape", "plain.txt", "missing.env", "huge.bin"],
      setup: ["node -e \"console.error('install broke'); process.exit(3)\"", "node -e \"require('fs').writeFileSync('after.txt', 'ran')\""],
    }, ["escape", "missing.env", "huge.bin", "after.txt"]);
    const increment = await park("email form");

    const made = await makeWorkspace(as("A"), increment, "building the email form", {}, { setupLimits: { copyBytes: 50 } });

    assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
    const why = Object.fromEntries((made.setup?.steps ?? []).map((step) => [step.what, step.ok ? "ok" : step.why]));
    assert.match(why["../outside.txt"] ?? "", /`\.\.`/);
    assert.match(why[path.join(dir, "outside.txt")] ?? "", /absolute/);
    assert.match(why["escape"] ?? "", /out of the repository/);
    assert.match(why["plain.txt"] ?? "", /does not ignore/);
    assert.match(why["missing.env"] ?? "", /nothing there/);
    assert.match(why["huge.bin"] ?? "", /cap/);
    assert.match(why["node -e \"console.error('install broke'); process.exit(3)\""] ?? "", /exited 3: install broke/);
    assert.equal(why["node -e \"require('fs').writeFileSync('after.txt', 'ran')\""], "ok", "the next command still ran");
    assert.ok(existsSync(path.join(made.folder, "after.txt")));
    for (const name of ["outside.txt", "escape", "plain.txt", "huge.bin"]) assert.ok(!existsSync(path.join(made.folder, name)), `${name} is not copied`);
    assert.equal(readFileSync(path.join(made.folder, "README.md"), "utf8").replace(/\r\n/g, "\n"), "site\n", "the worktree is kept");
    assert.deepEqual((await readClaims(log, project)).map(({ increment, branch }) => ({ increment, branch })), [{ increment, branch: made.branch }], "the claim is kept");

    localSetup(site, "{ not json");
    const unparsed = await makeWorkspace(as("A"), await park("reset"), "building the reset");
    assert.ok(unparsed.ok && unparsed.status === "ready", JSON.stringify(unparsed));
    assert.equal(unparsed.setup?.steps.length, 1);
    assert.match(unparsed.setup?.steps[0]?.why ?? "", /cannot be read/);

    localSetup(site, { setup: ["node -e \"require('fs').writeFileSync('tracked-ran.txt', '')\""] });
    writeFileSync(path.join(site, ".git", "info", "exclude"), "");
    git(site, "add", ".storytree/worktree.local.json");
    git(site, "commit", "-m", "check the setup in");
    const checkedIn = await makeWorkspace(as("A"), await park("profile"), "building the profile");
    assert.ok(checkedIn.ok && checkedIn.status === "ready", JSON.stringify(checkedIn));
    assert.match(checkedIn.setup?.steps[0]?.why ?? "", /git tracks it/);
    assert.equal(checkedIn.setup?.steps[0]?.ok, false, "a tracked local file is a failed step");
    assert.ok(!existsSync(path.join(checkedIn.folder, "tracked-ran.txt")), "a checked-in file's commands are not run");
  });
});

test("19.3 · a workspace made in a project with no `.storytree/worktree.local.json` is made exactly as before: nothing is run, copied or shared, and its answer reports no setup", async () => {
  await withWorld(async ({ site, park, as }) => {
    writeFileSync(path.join(site, ".env"), "SECRET=1\n");

    const made = await makeWorkspace(as("A"), await park("email form"), "building the email form");

    assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
    assert.equal("setup" in made, false, "no setup is reported");
    assert.ok(!existsSync(path.join(made.folder, ".env")), "nothing is copied");
  });
});

test("19.1 · the workspace command and the make_workspace tool each report the setup they ran, a line a step, and a failed step with why under a head line counting the failures", async () => {
  await withWorld(async ({ log, library, project, site, park, as }) => {
    writeFileSync(path.join(site, ".env"), "SECRET=1\n");
    localSetup(site, { copy: [".env", "missing.env"], setup: ["node -e \"process.exit(0)\""] }, [".env", "missing.env"]);
    const verb = WORKSPACE_FAMILIES[0]!.bare!;
    const tools = new Map<string, (args: Record<string, unknown>, call: ToolCall) => Promise<{ text: string; data?: Record<string, unknown> }>>();
    sessionTools().registerTools?.((name, _description, _input, act) => { tools.set(name, act as never); });

    const command = await verb.act({ work: await park("email form"), reason: "building the email form", "despite-open-pulls": false }, as("A"), WORDS);
    const tool = await tools.get("make_workspace")!({ increment: await park("reset"), reason: "building the reset" }, { library, log, project, caller: { session: "A" }, folder: site, quietMs: 0, writer: {} } as unknown as ToolCall);

    for (const [door, text] of [["command", command.text], ["tool", tool.text]] as const) {
      assert.match(text, /Set up from \.storytree\/worktree\.local\.json, with 1 step failed/, door);
      assert.match(text, /^ {2}copied \.env$/m, door);
      assert.match(text, /^ {2}FAILED copy missing\.env: the main checkout has nothing there$/m, door);
      assert.match(text, /^ {2}ran node -e "process\.exit\(0\)"$/m, door);
      assert.doesNotMatch(text, /as this project does at session start/, door);
    }
    assert.equal((tool.data?.setup as { steps: unknown[] } | undefined)?.steps.length, 3, "the tool's data carries the steps");

    rmSync(path.join(site, ".storytree"), { recursive: true });
    const plain = await verb.act({ work: await park("profile"), reason: "building the profile", "despite-open-pulls": false }, as("A"), WORDS);
    assert.doesNotMatch(plain.text, /Set up from/);
    assert.match(plain.text, /as this project does at session start/, "with no local file the agent is told to set it up itself, as before");
  });
});

test("19.5 · a Codex session attaching the worktree its app just made at the prepared commit has it set up from the local file, reported in the attach's answer, and set up once however often it attaches; a Claude Code session attaching its own worktree runs no setup", async () => {
  await withWorld(async ({ dir, log, library, project, site, park, as }) => {
    writeFileSync(path.join(site, ".env"), "SECRET=1\n");
    localSetup(site, { copy: [".env"], setup: ["node -e \"require('fs').appendFileSync('installed.txt', 'once\\n')\""] }, [".env", "installed.txt"]);
    const increment = await park("email form");
    const prepared = await makeWorkspace(as("B"), increment, "build form");
    assert.ok(prepared.ok && prepared.status === "prepared", JSON.stringify(prepared));
    const folder = path.join(dir, "app made");
    git(site, "worktree", "add", "--detach", folder, prepared.ref);

    const attached = await workspace.attachWorkspace(as("B"), increment, "build form", { folder, ref: prepared.ref, name: prepared.name });

    assert.ok(attached.ok, JSON.stringify(attached));
    assert.equal(readFileSync(path.join(folder, ".env"), "utf8"), "SECRET=1\n", "the file is copied");
    assert.deepEqual(attached.setup?.steps.map(({ kind, ok }) => ({ kind, ok })), [{ kind: "copy", ok: true }, { kind: "run", ok: true }]);
    assert.equal((await release(as("B"), increment)).ok, true);
    const again = await workspace.attachWorkspace(as("B"), increment, "build form", { folder: folder, ref: prepared.ref, name: prepared.name });
    assert.ok(again.ok, JSON.stringify(again));
    assert.equal("setup" in again, false, "a worktree already set up is not set up again");
    assert.equal(readFileSync(path.join(folder, "installed.txt"), "utf8"), "once\n");

    const tools = new Map<string, (args: Record<string, unknown>, call: ToolCall) => Promise<{ text: string; data?: Record<string, unknown> }>>();
    sessionTools().registerTools?.((name, _description, _input, act) => { tools.set(name, act as never); });
    const reset = await park("reset");
    const ready = await makeWorkspace(as("B"), reset, "build reset");
    assert.ok(ready.ok && ready.status === "prepared", JSON.stringify(ready));
    const other = path.join(dir, "app made too");
    git(site, "worktree", "add", "--detach", other, ready.ref);
    const tool = await tools.get("attach_workspace")!({ increment: reset, reason: "build reset", folder: other, ref: ready.ref, name: ready.name }, { library, log, project, caller: { session: "B", harness: "codex" }, folder: site, quietMs: 0, writer: {} } as unknown as ToolCall);
    assert.match(tool.text, /Set up from \.storytree\/worktree\.local\.json:\n {2}copied \.env/);
    assert.doesNotMatch(tool.text, /as this project does at session start/);
    assert.equal((tool.data?.setup as { steps: unknown[] } | undefined)?.steps.length, 2, "the tool's data carries the steps");

    const verb = WORKSPACE_FAMILIES[0]!.verbs.find((one) => one.command !== undefined && "name" in one.command && one.command.name === "attach")!;
    const profile = await park("profile");
    const named = await makeWorkspace(as("B"), profile, "build profile");
    assert.ok(named.ok && named.status === "prepared", JSON.stringify(named));
    const third = path.join(dir, "app made third");
    git(site, "worktree", "add", "--detach", third, named.ref);
    const command = await verb.act({ work: profile, folder: third, ref: named.ref, name: named.name, reason: "build profile" }, as("B"), WORDS);
    assert.match(command.text, /Set up from \.storytree\/worktree\.local\.json:\n {2}copied \.env/);
    assert.doesNotMatch(command.text, /as this project does at session start/);

    const own = path.join(dir, "claude app made");
    git(site, "worktree", "add", "-b", "claude/app-made", own, "main");
    const claude = await workspace.attachWorkspace(as("A", own), await park("settings"), "build settings", { folder: own });
    assert.ok(claude.ok, JSON.stringify(claude));
    assert.equal("setup" in claude, false);
    assert.ok(!existsSync(path.join(own, ".env")), "nothing is copied into a Claude Code session's own worktree");
  });
});

/**
 * Run `body` with storytree's home in `home` and the harness saying whether anyone attends the session, as a
 * headless lane's does (CLAUDE_CODE_SESSION_ATTENDED=0); both restored after.
 */
async function withHome(home: string, attended: boolean, body: () => Promise<void>): Promise<void> {
  const before = { home: process.env.STORYTREE_HOME, attended: process.env.CLAUDE_CODE_SESSION_ATTENDED };
  process.env.STORYTREE_HOME = home;
  if (attended) delete process.env.CLAUDE_CODE_SESSION_ATTENDED;
  else process.env.CLAUDE_CODE_SESSION_ATTENDED = "0";
  try {
    await body();
  } finally {
    for (const [name, value] of [["STORYTREE_HOME", before.home], ["CLAUDE_CODE_SESSION_ATTENDED", before.attended]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

/** Check `setup` in as the project's `.storytree/worktree.json` in the main checkout `site`, beside an untracked local file when `local` is given. */
function checkedInSetup(site: string, setup: unknown, local?: unknown, ignored: readonly string[] = []): void {
  mkdirSync(path.join(site, ".storytree"), { recursive: true });
  writeFileSync(path.join(site, ".git", "info", "exclude"), [".storytree/worktree.local.json", ...ignored].join("\n") + "\n");
  writeFileSync(path.join(site, ".storytree", "worktree.json"), JSON.stringify(setup));
  git(site, "add", ".storytree/worktree.json");
  git(site, "commit", "-m", "check the setup in");
  if (local !== undefined) writeFileSync(path.join(site, ".storytree", "worktree.local.json"), JSON.stringify(local));
}

const WRITES = (name: string) => `node -e "require('fs').writeFileSync('${name}', 'ran')"`;

test("19.6 · a checked-in `.storytree/worktree.json` is read beside the local file, the local file winning key by key, and its setup and teardown commands run only once the user has approved that exact set: before then, or after they change, the workspace is made without them and its answer names the command that approves them", async () => {
  await withWorld(async ({ dir, site, park, as }) => {
    await withHome(path.join(dir, "home"), true, async () => {
      writeFileSync(path.join(site, "a.env"), "A\n");
      writeFileSync(path.join(site, "b.env"), "B\n");
      checkedInSetup(site, { copy: ["a.env"], setup: [WRITES("checked.txt")], teardown: ["node -e \"process.exit(0)\""] }, { copy: ["b.env"] }, ["a.env", "b.env", "checked.txt"]);

      const first = await makeWorkspace(as("A"), await park("email form"), "building the email form");

      assert.ok(first.ok && first.status === "ready", JSON.stringify(first));
      assert.ok(existsSync(path.join(first.folder, "b.env")) && !existsSync(path.join(first.folder, "a.env")), "the local file's copy wins over the checked-in one");
      assert.ok(!existsSync(path.join(first.folder, "checked.txt")), "an unapproved command does not run");
      assert.equal(teardownState(first.folder), "none", "nor is its teardown kept to run");
      const asked = first.setup?.steps.find((step) => !step.ok);
      const fingerprint = /setup needs approval: run `storytree workspace approve-setup ([0-9a-f]{16})`/.exec(asked?.why ?? "")?.[1];
      assert.ok(fingerprint !== undefined, JSON.stringify(first.setup));
      assert.match(asked?.why ?? "", /checked\.txt/, "the commands awaiting approval are named");

      setSetupApproval(realpathSync(site), fingerprint);
      const approved = await makeWorkspace(as("A"), await park("reset"), "building the reset");
      assert.ok(approved.ok && approved.status === "ready", JSON.stringify(approved));
      assert.ok(existsSync(path.join(approved.folder, "checked.txt")), "an approved command runs");
      assert.equal(teardownState(approved.folder), "due", "and its teardown is kept to run");
      assert.ok(approved.setup?.steps.every((step) => step.ok), JSON.stringify(approved.setup));

      checkedInSetup(site, { setup: [WRITES("changed.txt")] }, { copy: ["b.env"] }, ["a.env", "b.env", "checked.txt", "changed.txt"]);
      const changed = await makeWorkspace(as("A"), await park("profile"), "building the profile");
      assert.ok(changed.ok && changed.status === "ready", JSON.stringify(changed));
      assert.ok(!existsSync(path.join(changed.folder, "changed.txt")), "changed commands are asked again");
      const again = /approve-setup ([0-9a-f]{16})/.exec(changed.setup?.steps.find((step) => !step.ok)?.why ?? "")?.[1];
      assert.ok(again !== undefined && again !== fingerprint, JSON.stringify(changed.setup));

      checkedInSetup(site, { setup: [WRITES("checked.txt")] }, { setup: [WRITES("local.txt")] }, ["a.env", "b.env", "checked.txt", "local.txt"]);
      const local = await makeWorkspace(as("A"), await park("settings"), "building the settings");
      assert.ok(local.ok && local.status === "ready", JSON.stringify(local));
      assert.ok(existsSync(path.join(local.folder, "local.txt")) && !existsSync(path.join(local.folder, "checked.txt")), "the local file's setup wins and needs no approval");
      assert.ok(local.setup?.steps.every((step) => step.ok), JSON.stringify(local.setup));
    });
  });
});

test("19.8 · when an agent runs alone (its harness says no one is attending), an unapproved checked-in setup's commands are skipped and the workspace's answer says no one is here to approve them, rather than asking", async () => {
  await withWorld(async ({ dir, site, park, as }) => {
    await withHome(path.join(dir, "home"), false, async () => {
      checkedInSetup(site, { setup: [WRITES("checked.txt")] }, undefined, ["checked.txt"]);
      const verb = WORKSPACE_FAMILIES[0]!.bare!;

      const made = await verb.act({ work: await park("email form"), reason: "building the email form", "despite-open-pulls": false }, as("A"), WORDS);

      assert.match(made.text, /SKIPPED .*no one is here to approve/);
      assert.doesNotMatch(made.text, /setup needs approval/);
      assert.equal(readSetupApproval(realpathSync(site)), undefined);
      const folder = /Made workspace (.+)/.exec(made.text)?.[1]?.trim();
      assert.ok(folder !== undefined && existsSync(folder), made.text);
      assert.ok(!existsSync(path.join(folder, "checked.txt")), "the command is skipped");
    });
  });
});

test("19.7 · `storytree workspace approve-setup <fingerprint>` records the user's approval of the checked-in setup's commands only from a person at their own terminal, and is refused, recording nothing, when the fingerprint is not the checked-in file's current one", async () => {
  await withWorld(async ({ dir, site, park, as }) => {
    await withHome(path.join(dir, "home"), true, async () => {
      checkedInSetup(site, { setup: [WRITES("checked.txt")] }, undefined, ["checked.txt"]);
      const made = await makeWorkspace(as("A"), await park("email form"), "building the email form");
      assert.ok(made.ok && made.status === "ready", JSON.stringify(made));
      const fingerprint = /approve-setup ([0-9a-f]{16})/.exec(made.setup?.steps.find((step) => !step.ok)?.why ?? "")?.[1]!;
      const verb = WORKSPACE_FAMILIES[0]!.verbs.find((one) => one.command !== undefined && "name" in one.command && one.command.name === "approve-setup")!;
      const person = { ...as("A", made.folder), session: "person:mick" };
      const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
      const terminal = (on: boolean) => Object.defineProperty(process.stdin, "isTTY", { value: on, configurable: true });
      try {
        terminal(true);
        await assert.rejects(verb.act({ fingerprint }, as("A"), WORDS), /An agent cannot/);
        await assert.rejects(verb.act({ fingerprint: "0000000000000000" }, person, WORDS), /not the fingerprint/);
        terminal(false);
        await assert.rejects(verb.act({ fingerprint }, person, WORDS), /your own terminal/);
        assert.equal(readSetupApproval(realpathSync(site)), undefined, "nothing is recorded");

        terminal(true);
        const approved = await verb.act({ fingerprint }, person, WORDS);
        assert.match(approved.text, /Approved/);
        assert.equal(readSetupApproval(realpathSync(site))?.fingerprint, fingerprint);
      } finally {
        if (tty === undefined) delete (process.stdin as { isTTY?: boolean }).isTTY;
        else Object.defineProperty(process.stdin, "isTTY", tty);
      }
      const after = await makeWorkspace(as("A"), await park("reset"), "building the reset");
      assert.ok(after.ok && after.status === "ready" && existsSync(path.join(after.folder, "checked.txt")), JSON.stringify(after));
    });
  });
});

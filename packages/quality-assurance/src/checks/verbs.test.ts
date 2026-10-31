/**
 * Capability 1 · Quality control checks: the `quality` family this package declares for the command line to mount
 * (ADR-1033 D3), acted in a fresh project's library on the real Postgres `pnpm test` provides, as a door hands it.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { VerbRefusal, type DoorWords } from "@storytree/library/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";

import { claim, forgetProjectActivity, openActivityLog } from "@storytree/session-management";

import { testServerUrl, withLibrary } from "../testing/pg.js";
import { QUALITY_FAMILIES } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };

test("1.3 · Quality assurance declares the `quality` verbs the command line mounts: `quality checks` answers with the checks reading, and a verb that needs the ledger is refused when the door hands no server", async () => {
  const [family] = QUALITY_FAMILIES;
  assert.equal(family!.name, "quality");
  assert.equal(family!.order, 10);
  const verbs = new Map(family!.verbs.map((one) => [(one.command as { name: string }).name, one]));
  assert.deepEqual([...verbs.keys()], ["checks", "ledger", "brief", "take", "answer", "standing", "graduate", "risk", "story-risks"]);

  await withLibrary(async (library) => {
    const principle = await library.writeKnowledge("principle", { title: "Test creation principles", description: "How a test earns its place.", statement: "A test fails if its behaviour is removed.", why: "A test that cannot fail protects nothing.", howToApply: "Delete the behaviour and watch the test fail." });
    const check = await library.writeKnowledge("check", { title: "Tautological expected value", description: "Expected values computed as the code computes them.", question: "Is any expected value computed the way the code computes it?", enforces: [principle.id] });
    // No server and no activity log: the door hands the caller without them.
    const context = { folder: process.cwd(), library, project: library.name, session: "person:test" } as unknown as SessionVerbContext;

    const answered = await verbs.get("checks")!.act({}, context, WORDS);
    assert.equal(answered.text, [
      "1 quality control check:",
      `  ${check.id}  Tautological expected value`,
      "    Is any expected value computed the way the code computes it?",
      `    enforces ${principle.id}  [principle]  Test creation principles`,
    ].join("\n"));

    await assert.rejects(
      verbs.get("ledger")!.act({}, context, WORDS),
      (error: unknown) => error instanceof VerbRefusal && !error.misuse && /QA ledger .*library server/.test(error.message),
    );
  });
});

test("2.8 · `quality brief` and `quality risk` run in a worktree whose generic claimed branch was renamed to name the increment read that worktree's change, and another increment's claim is still refused naming its branch", async () => {
  const root = mkdtempSync(join(tmpdir(), "qa-verbs-renamed-"));
  const dir = join(root, "repo");
  const worktree = join(root, "wt");
  try {
    const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd });
    mkdirSync(join(dir, "packages/library/src"), { recursive: true });
    git(dir, "init", "-q");
    writeFileSync(join(dir, "packages/library/package.json"), JSON.stringify({ name: "@storytree/library" }));
    writeFileSync(join(dir, "packages/library/src/notes.md"), "base\n");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "base");
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");

    await withLibrary(async (library, storytree) => {
      const story = await library.addStory({ title: "The library" });
      const arc = await library.createArc({ title: "Notes", intent: "Write notes", endState: "Written", stories: [story.id] });
      const increment = await library.addIncrement({ arc: arc.id, title: "Notes", objective: "Write notes", body: "b", capabilities: [] });
      const other = await library.addIncrement({ arc: arc.id, title: "Other", objective: "Other", body: "b", capabilities: [] });
      const id = increment.id.replace(/^increment_/, "");
      git(dir, "worktree", "add", "-q", "-b", "work", worktree, "origin/main");
      writeFileSync(join(worktree, "packages/library/src/notes.md"), "base\nthe renamed branch's change\n");
      git(worktree, "commit", "-qam", "the change");
      const log = await openActivityLog(testServerUrl());
      try {
        for (const [session, held, branch] of [["S", increment.id, "work"], ["T", other.id, "elsewhere"]] as const) {
          assert.equal((await claim({ log, library, project: library.name, session, branch }, held, "notes", { keepBranch: true })).ok, true);
        }
        git(worktree, "branch", "-m", `claude/increment-${id}-x`);
        const context = { folder: worktree, library, project: library.name, session: "person:test", server: storytree, log } as unknown as SessionVerbContext;
        const verbs = new Map(QUALITY_FAMILIES[0]!.verbs.map((one) => [(one.command as { name: string }).name, one]));

        const brief = await verbs.get("brief")!.act({ increment: increment.id }, context, WORDS);
        assert.match(brief.text, /\+the renamed branch's change/);
        const risk = await verbs.get("risk")!.act({ increment: increment.id }, context, WORDS);
        assert.match(risk.text, new RegExp(`^Wrote ${increment.id}'s risk line`));
        // Each verb reads the claim of the increment it is given: the other's, on a branch no worktree is on, is refused naming it.
        await assert.rejects(verbs.get("brief")!.act({ increment: other.id }, context, WORDS), /branch elsewhere/);
        await assert.rejects(verbs.get("risk")!.act({ increment: other.id }, context, WORDS), /branch elsewhere/);
      } finally {
        await log.close();
        await forgetProjectActivity(storytree, library.name);
      }
    });
  } finally {
    await removeTemp(root);
  }
});

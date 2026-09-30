// The generated guidance (packages/dev-loop/src/guidance.mjs): 0.3's own CLAUDE.md region, AGENTS.md and the
// Claude Code and Codex role files are generated from the agent roles in the library, checked for
// drift against it, and held to a size budget (ADR-0636 D1, b5; 0.2's `build:guidance` /
// `build:agents` / `check:guidance` / `check:agents`, ported as behaviour per ADR-0633 D2).
//
// 1. The library's `session-orchestrator` role becomes CLAUDE.md's generated region and AGENTS.md,
//    one digest in both; every other role becomes .claude/agents/<name>.md and .codex/agents/<name>.toml.
//    A role's links print as the titles of the notes they name, and its model and effort, when set,
//    reach its files (Codex takes the effort alone, since it names no Claude model).
// 2. With no `session-orchestrator` role in the library, the region and AGENTS.md say so plainly.
// 3. The drift check names a stale region, a missing or stale file, and an orphan role file, and
//    ignores line endings; a tree just built has no drift.
// 4. A file over its size budget is named with its size and its budget.
// 5. A CLAUDE.md without the region's markers is refused, naming them.
//
// The tests that read a library run against the Postgres `pnpm test` provides
// (STORYTREE_TEST_PG_URL), in a project of their own that is dropped afterwards.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { connect } from "@storytree/library";
import pg from "pg";

import { BUDGETS, driftOf, expectedFiles, overBudget, readRoles, REGION_END, REGION_START } from "./guidance.mjs";

const CLAUDE_MD = ["# storytree 0.3", "", "Written by hand.", "", `${REGION_START} -->`, "old", REGION_END, "", "After."].join("\n");

async function withRoles(body) {
  await withLibrary(async (library) => {
    const reading = await library.writeKnowledge("principle", {
      title: "Red before green",
      description: "Every contract fails before it passes",
      statement: "Write the test first",
      why: "A test never seen failing proves nothing",
      howToApply: "Run it red, then make it green",
    });
    const refuse = await library.writeKnowledge("guardrail", {
      title: "Never squash a merge",
      description: "Keep the red commit",
      statement: "Merge commits only",
      rule: "No squash merges",
      enforcedBy: "review",
      failureMode: "The red commit is lost",
    });
    const role = (title, extra = {}) =>
      library.writeKnowledge("agent", {
        title,
        description: `${title}, the role`,
        oneLine: `The ${title} does its one job`,
        role: `Role of ${title}`,
        outcome: `Outcome of ${title}`,
        context: [reading.id],
        tools: "Read, Edit",
        workflow: `Workflow of ${title}`,
        ...extra,
      });
    await role("Session orchestrator", { antiPatterns: [refuse.id], escalation: "Ask the owner" });
    await role("Story author", { model: "opus", effort: "xhigh" });
    await body(await readRoles(library));
  });
}

test("4.1 the session-orchestrator role is CLAUDE.md's region and AGENTS.md; every other role is a Claude Code and a Codex role file", async () => {
  await withRoles(async (roles) => {
    const files = expectedFiles(roles, CLAUDE_MD);
    assert.deepEqual([...files.keys()].sort(), [".claude/agents/story-author.md", ".codex/agents/story-author.toml", "AGENTS.md", "CLAUDE.md"]);

    const claude = files.get("CLAUDE.md");
    assert.ok(claude.startsWith("# storytree 0.3\n\nWritten by hand.\n"), "the hand-written part is kept");
    assert.ok(claude.endsWith(`${REGION_END}\n\nAfter.`), "and so is what follows the region");
    assert.ok(!claude.includes("\nold\n"), "the region's old text is replaced");
    const region = claude.slice(claude.indexOf(REGION_START), claude.indexOf(REGION_END));
    for (const text of ["The Session orchestrator does its one job", "Role of Session orchestrator", "Outcome of Session orchestrator", "Workflow of Session orchestrator", "Ask the owner", "Red before green", "Never squash a merge"]) {
      assert.ok(region.includes(text), `the region holds "${text}"`);
    }
    assert.ok(files.get("AGENTS.md").includes(region.slice(region.indexOf("\n") + 1).trim()), "AGENTS.md carries the same digest");
    assert.ok(!region.includes("Story author"), "other roles are not in the region");

    const md = files.get(".claude/agents/story-author.md");
    assert.match(md, /^---\nname: story-author\ndescription: "The Story author does its one job"\nmodel: opus\neffort: xhigh\n---\n/);
    for (const text of ["Role of Story author", "Workflow of Story author", "Read, Edit", "Red before green"]) assert.ok(md.includes(text), `the role file holds "${text}"`);

    const toml = files.get(".codex/agents/story-author.toml");
    assert.match(toml, /^name = "story-author"\ndescription = "The Story author does its one job"\nmodel_reasoning_effort = "xhigh"\ndeveloper_instructions = """\n/);
    assert.ok(toml.includes("Workflow of Story author"));
  });
});

test("2. with no session-orchestrator role, the region and AGENTS.md say so plainly", async () => {
  await withLibrary(async (library) => {
    const files = expectedFiles(await readRoles(library), CLAUDE_MD);
    assert.deepEqual([...files.keys()].sort(), ["AGENTS.md", "CLAUDE.md"]);
    for (const name of ["CLAUDE.md", "AGENTS.md"]) {
      assert.match(files.get(name), /The library holds no `session-orchestrator` agent role yet/, name);
    }
  });
});

test("4.2 the drift check names a stale region, missing and stale files and an orphan, and ignores line endings", () => {
  const expected = new Map([
    ["CLAUDE.md", CLAUDE_MD],
    ["AGENTS.md", "agents\n"],
    [".claude/agents/a.md", "a\n"],
    [".codex/agents/a.toml", "a\n"],
  ]);
  const onDisk = new Map([
    ["CLAUDE.md", CLAUDE_MD.replace(/\n/g, "\r\n")],
    ["AGENTS.md", "agents\r\n"],
    [".claude/agents/a.md", "a\n"],
    [".codex/agents/a.toml", "a\n"],
  ]);
  const disk = (files) => ({ read: (file) => files.get(file), list: (dir) => [...files.keys()].filter((file) => file.startsWith(`${dir}/`)) });
  assert.deepEqual(driftOf(expected, disk(onDisk)), [], "a tree just built has no drift, whatever its line endings");

  const drifted = new Map(onDisk);
  drifted.set("CLAUDE.md", CLAUDE_MD.replace("\nold\n", "\nedited by hand\n"));
  drifted.delete("AGENTS.md");
  drifted.set(".claude/agents/a.md", "changed\n");
  drifted.set(".codex/agents/gone.toml", "left behind\n");
  assert.deepEqual(driftOf(expected, disk(drifted)), [
    { file: "CLAUDE.md", problem: "stale" },
    { file: "AGENTS.md", problem: "missing" },
    { file: ".claude/agents/a.md", problem: "stale" },
    { file: ".codex/agents/gone.toml", problem: "orphan" },
  ]);
});

test("4.3 a file over its size budget is named with its size and its budget", () => {
  const files = new Map([
    ["CLAUDE.md", "x".repeat(BUDGETS["CLAUDE.md"] + 1)],
    ["AGENTS.md", "x".repeat(BUDGETS["AGENTS.md"])],
    [".claude/agents/big.md", "é".repeat(BUDGETS.role)],
  ]);
  assert.deepEqual(overBudget(files), [
    { file: "CLAUDE.md", bytes: BUDGETS["CLAUDE.md"] + 1, budget: BUDGETS["CLAUDE.md"] },
    { file: ".claude/agents/big.md", bytes: BUDGETS.role * 2, budget: BUDGETS.role },
  ], "bytes are counted, not characters, and a file at its budget is within it");
});

test("4.2 a CLAUDE.md without the region's markers is refused, naming them", () => {
  const roles = { root: undefined, others: [], titles: new Map() };
  assert.throws(() => expectedFiles(roles, "# no region here\n"), (error) => error.message.includes(REGION_START) && error.message.includes(REGION_END));
});

async function withLibrary(body) {
  const url = process.env.STORYTREE_TEST_PG_URL;
  assert.ok(url, "STORYTREE_TEST_PG_URL is not set: run these tests through `pnpm test`, which starts a local Postgres");
  const name = `t-${randomBytes(4).toString("hex")}`;
  const storytree = await connect({ url });
  try {
    const library = await storytree.openProject(name);
    try {
      await body(library);
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "storytree_${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}

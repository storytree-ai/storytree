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
// 6. The check fails a branch only on its own drift; drift from another editor's unlanded library
//    edit is named with that editor and fails nothing (4.5).
//
// The tests that read a library run against the Postgres `pnpm test` provides
// (STORYTREE_TEST_PG_URL), in a project of their own that is dropped afterwards.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";
import { connect } from "@storytree/library";
import { dropTestDatabases } from "@storytree/local-postgres/testing";

import { syncGuidance } from "./build-guidance.mjs";
import { BUDGETS, driftOf, expectedFiles, judgeDrift, overBudget, readRoles, REGION_END, REGION_START, sourcesOf } from "./guidance.mjs";

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

test("4.2 the check writes nothing and fails on drift; the build writes stale and missing files and removes an orphan role and skill, after which the check passes", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "guidance-sync-"));
  t.after(() => removeTemp(root));
  const put = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  put("CLAUDE.md", CLAUDE_MD);
  put(".claude/agents/a.md", "stale\n");
  put(".codex/agents/gone.toml", "left behind\n");
  put(".claude/skills/old/SKILL.md", "an old skill\n");
  const expected = new Map([["CLAUDE.md", CLAUDE_MD], ["AGENTS.md", "agents\n"], [".claude/agents/a.md", "a\n"]]);
  const said = [];
  const io = { log: (line) => said.push(line), error: (line) => said.push(line) };

  assert.equal(syncGuidance(expected, { root, check: true, ...io }), 1);
  assert.match(said.join("\n"), /missing: AGENTS\.md[\s\S]*stale: \.claude\/agents\/a\.md[\s\S]*orphan: \.codex\/agents\/gone\.toml/);
  assert.equal(existsSync(path.join(root, "AGENTS.md")), false, "the check writes nothing");

  assert.equal(syncGuidance(expected, { root, check: false, ...io }), 0);
  assert.equal(readFileSync(path.join(root, "AGENTS.md"), "utf8"), "agents\n");
  assert.equal(readFileSync(path.join(root, ".claude/agents/a.md"), "utf8"), "a\n");
  assert.equal(existsSync(path.join(root, ".codex/agents/gone.toml")), false);
  assert.equal(existsSync(path.join(root, ".claude/skills/old")), false, "an orphan skill's emptied folder goes too");
  assert.equal(syncGuidance(expected, { root, check: true, ...io }), 0);
});

test("4.3 a build over a size budget fails, naming the file", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "guidance-sync-"));
  t.after(() => removeTemp(root));
  const said = [];
  const big = "x".repeat(BUDGETS["AGENTS.md"] + 1);
  assert.equal(syncGuidance(new Map([["AGENTS.md", big]]), { root, check: false, log: () => {}, error: (line) => said.push(line) }), 1);
  assert.deepEqual(said, [`over budget: AGENTS.md is ${big.length} bytes; its budget is ${BUDGETS["AGENTS.md"]}`]);
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

test("4.4 a process note marked as a skill is written out as a Claude Code and a Codex skill, and drift-checked", async () => {
  await withLibrary(async (library) => {
    const reading = await library.writeKnowledge("principle", {
      title: "Register follows audience",
      description: "Write for who reads it",
      statement: "Lead with the answer",
      why: "The owner reads cold",
      howToApply: "Answer first",
    });
    const term = await library.defineTerm({ term: "Standing delegation", meaning: "What a session may decide alone" });
    const process = (title, extra = {}) =>
      library.writeKnowledge("process", {
        title,
        description: `${title}: use when he says "grill me"`,
        statement: `Statement of ${title}`,
        trigger: `Trigger of ${title}`,
        steps: `1. Steps of ${title}`,
        surfaces: `Surfaces of ${title}`,
        failureModes: `Failure modes of ${title}`,
        ...extra,
      });
    await process("Question round", { skill: "grill-me", links: [reading.id, term.id], verification: "Verification of Question round" });
    await process("Merge ceremony");
    const files = expectedFiles(await readRoles(library), CLAUDE_MD);
    assert.deepEqual([...files.keys()].filter((file) => file.includes("skills/")).sort(), [".agents/skills/grill-me/SKILL.md", ".claude/skills/grill-me/SKILL.md"], "only the note marked as a skill is written, for each harness");

    const skill = files.get(".claude/skills/grill-me/SKILL.md");
    assert.equal(files.get(".agents/skills/grill-me/SKILL.md"), skill, "Codex reads the same file");
    assert.match(skill, /^---\nname: grill-me\ndescription: "Question round: use when he says \\"grill me\\""\n---\n/);
    for (const text of ["Statement of Question round", "Trigger of Question round", "1. Steps of Question round", "Surfaces of Question round", "Failure modes of Question round", "Verification of Question round", "Register follows audience", "Standing delegation"]) {
      assert.ok(skill.includes(text), `the skill holds "${text}"`);
    }

    const disk = (onDisk) => ({ read: (file) => onDisk.get(file), list: (dir) => [...onDisk.keys()].filter((file) => file.startsWith(`${dir}/`)) });
    const drifted = new Map(files);
    drifted.set(".claude/skills/grill-me/SKILL.md", `${skill}edited by hand\n`);
    drifted.set(".agents/skills/gone/SKILL.md", "left behind\n");
    assert.deepEqual(driftOf(files, disk(drifted)), [
      { file: ".claude/skills/grill-me/SKILL.md", problem: "stale" },
      { file: ".agents/skills/gone/SKILL.md", problem: "orphan" },
    ]);
  });
});

test("4.6 a skill carries a linked pattern whole where its steps say {{include <id>}}, so editing the pattern and rebuilding changes the skill", () => {
  const pattern = (approach) => ({ id: "pattern_5ab3b3241c67", type: "pattern", fields: { title: "Briefing the owner", description: "d", statement: "Brief him one way.", problem: "They drifted.", approach, tradeoffs: "Voice saves notes." } });
  const skill = { id: "process_1", type: "process", fields: { title: "Grill", description: "Grill him", statement: "s", trigger: "t", steps: "Before.\n\n{{include pattern_5ab3b3241c67}}\n\n1. After.", surfaces: "u", failureModes: "f", skill: "grill-me", links: ["pattern_5ab3b3241c67"] } };
  const built = (note) => expectedFiles({ root: undefined, others: [], skills: [skill], titles: new Map([[note.id, note.fields.title]]), notes: new Map([[note.id, note]]) }, CLAUDE_MD).get(".claude/skills/grill-me/SKILL.md");

  const before = built(pattern("1. OPENING. Open with his actions."));
  assert.ok(!before.includes("{{include"), "the marker is replaced");
  for (const text of ["Brief him one way.", "1. OPENING. Open with his actions.", "Voice saves notes."]) assert.ok(before.includes(text), `the skill holds "${text}"`);
  assert.ok(before.indexOf("Before.") < before.indexOf("Brief him one way.") && before.indexOf("Voice saves notes.") < before.indexOf("1. After."), "in the marker's place");
  const after = built(pattern("1. OPENING. Open with his actions, then wait."));
  assert.ok(after.includes("Open with his actions, then wait.") && after !== before, "an edited pattern rebuilds a different skill");

  const unlinked = { ...skill, fields: { ...skill.fields, links: [] } };
  assert.throws(() => expectedFiles({ root: undefined, others: [], skills: [unlinked], titles: new Map(), notes: new Map([["pattern_5ab3b3241c67", pattern("a")]]) }, CLAUDE_MD), /includes pattern_5ab3b3241c67, which it does not link/);
  const principle = { id: "pattern_5ab3b3241c67", type: "principle", fields: { title: "Not a pattern" } };
  assert.throws(() => expectedFiles({ root: undefined, others: [], skills: [skill], titles: new Map([[principle.id, "Not a pattern"]]), notes: new Map([[principle.id, principle]]) }, CLAUDE_MD), /includes pattern_5ab3b3241c67, which is not a live pattern/);
});

test("4.4 a skill whose description is over 1,024 characters is refused, since Codex would not load it", () => {
  const skill = { id: "process_1", fields: { title: "Long", description: "x".repeat(1025), statement: "s", trigger: "t", steps: "1.", surfaces: "u", failureModes: "f", skill: "long" } };
  assert.throws(() => expectedFiles({ root: undefined, others: [], skills: [skill], titles: new Map() }, CLAUDE_MD), /"long".*1,025 characters.*1,024/);
});

test("4.2 a CLAUDE.md without the region's markers is refused, naming them", () => {
  const roles = { root: undefined, others: [], titles: new Map() };
  assert.throws(() => expectedFiles(roles, "# no region here\n"), (error) => error.message.includes(REGION_START) && error.message.includes(REGION_END));
});

test("4.5 the drift check fails a branch only on its own drift; another editor's unlanded edit is named with its editor and fails nothing", async (t) => {
  await withRoles(async (roles) => {
    const sources = sourcesOf(roles);
    const role = roles.others[0];
    assert.deepEqual(sources.get(".claude/agents/story-author.md"), [role.id, ...role.fields.context], "a role file stands on its role and the notes it links");
    assert.deepEqual(sources.get("CLAUDE.md"), [roles.root.id, ...roles.root.fields.context, ...roles.root.fields.antiPatterns]);

    const drift = [
      { file: ".claude/agents/story-author.md", problem: "stale" },
      { file: "AGENTS.md", problem: "stale" },
      { file: ".codex/agents/gone.toml", problem: "orphan" },
    ];
    const sibling = { actor: "session:sibling", at: "2026-10-12T10:00:00.000Z" };
    const mine = { actor: "session:me", at: "2026-10-12T09:00:00.000Z" };
    const writes = new Map([[role.id, [sibling]], [roles.root.id, [sibling]]]);
    const base = { sources, writes, me: "session:me", since: "2026-10-12T00:00:00.000Z", branchChanged: new Set(), onMain: new Set() };

    const judged = judgeDrift(drift, base);
    assert.deepEqual(judged.own.map(({ file }) => file), [".codex/agents/gone.toml"], "an orphan, whose role is gone, stays the branch's");
    assert.deepEqual(judged.others.map(({ file, editor }) => [file, editor.actor, editor.id]), [
      [".claude/agents/story-author.md", "session:sibling", role.id],
      ["AGENTS.md", "session:sibling", roles.root.id],
    ], "drift only a sibling's library edit explains is named with its editor");

    const own = (overrides) => judgeDrift(drift.slice(0, 1), { ...base, ...overrides }).own.map(({ why }) => why);
    assert.equal(own({ branchChanged: new Set([".claude/agents/story-author.md"]) }).length, 1, "a file the branch changes is its own");
    assert.equal(own({ writes: new Map([[role.id, [mine, sibling]]]) }).length, 1, "a role this session edited is its own, whoever wrote last");
    assert.equal(own({ writes: new Map([[role.id, [{ ...mine, at: "2026-10-11T00:00:00.000Z" }, sibling]]]) }).length, 0, "an edit of this session's before the branch forked is not");
    assert.match(own({ onMain: new Set([".claude/agents/story-author.md"]) })[0], /origin\/main/, "an edit already on main is the branch's to merge");
    assert.equal(own({ branchChanged: undefined }).length, 1, "when git cannot say what the branch changed, all drift is its own");

    const root = mkdtempSync(path.join(tmpdir(), "guidance-judge-"));
    t.after(() => removeTemp(root));
    writeFileSync(path.join(root, "AGENTS.md"), "old\n");
    const said = [];
    const io = { log: (line) => said.push(line), error: (line) => said.push(line) };
    const expected = new Map([["AGENTS.md", "new\n"]]);
    const judge = (found) => judgeDrift(found, base);
    assert.equal(syncGuidance(expected, { root, check: true, judge, ...io }), 0, "the check passes on a sibling's drift alone");
    assert.match(said.join("\n"), /AGENTS\.md.*session:sibling/, "and names its editor");
    assert.equal(syncGuidance(expected, { root, check: true, judge: (found) => judgeDrift(found, { ...base, writes: new Map([[roles.root.id, [mine]]]) }), ...io }), 1, "and fails on its own");
  });
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
    await dropTestDatabases([`storytree_${name}`]);
  }
}

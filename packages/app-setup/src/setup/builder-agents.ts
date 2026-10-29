/**
 * Capability 8 · Setup check, contract 8.38. storytree's red and green builder agents for Claude Code: two user-level
 * agent files, `<claude home>/agents/storytree-red.md` and `storytree-green.md`, written with storytree's hooks and taken
 * out with them. Each one's frontmatter runs the test guard (Session management's Hooks 3.50) before every file edit,
 * so the red agent can edit only test files and the green agent never one: the split is enforced, not only asked for.
 * A role in a project's library cannot carry a hook, which is why these are files of Claude Code's own.
 * They are user-level on purpose: Claude Code 2.1.311 runs an agent's frontmatter hooks for an agent in the user's
 * agents folder but not for one in a project's .claude/agents (tried both, 2026-10-29), so a project copy would be unfenced.
 *
 * A file is storytree's when it carries MARKER; a file of that name without it is the user's own and is never touched.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TEST_GUARD } from "@storytree/session-management";

import type { HookCommand } from "./hooks-config.js";

/** What marks an agent file as storytree's. */
const MARKER = "<!-- storytree builder agent: written and removed by storytree's setup -->";

type Mode = "red" | "green";
const MODES: readonly Mode[] = ["red", "green"];

/** The guard's command line, run by Claude Code through its shell: each path in double quotes. */
function guardCommand({ node, script }: HookCommand, mode: Mode): string {
  return `"${node}" "${script}" claude-code ${TEST_GUARD} ${mode}`;
}

/** A YAML single-quoted scalar: backslashes stay as they are, and a quote is doubled. */
function yamlQuoted(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

const BODY: Record<Mode, { description: string; text: string }> = {
  red: {
    description: "Red test writer for one increment: writes ONLY failing tests for the contracts it is given, proves each fails for the expected reason, justifies every test in a table, then stops for the user's approval before any production code is written. A hook refuses its edits to anything but test files.",
    text: `You write the failing tests for the contracts in your brief, justify each one, and stop. No production code: storytree's hook refuses any edit to a file that is not a test.

Rules for each test:
- Name the behaviour first, in one sentence a user would recognise. If you cannot, do not write the test.
- The fewest tests that go red for the missing behaviour, plus the unhappy paths the behaviour itself has.
- Deletion check: if the behaviour were removed, would this test fail? If not, drop it.
- Assert the outcome, not a proxy (that something exists, was called, or has a length above zero).
- Never compute the expected value the way the code does: write the literal you worked out.
- Stub a paid or network call only at a seam the code already has, with a fake of the real call's shape; never mock a whole module. No real time, network or unseeded randomness. No hidden skips.
- Start each test's name with its contract's number (test_1_2_..., or "1.2 ..." in a test title).

Workflow: read the code under test and the project's existing tests; write each test; run it with the project's own test command and confirm it FAILS for the missing behaviour (an assertion, the expected error not raised), not from an import, typo or collection error. A test that already passes guards an existing behaviour: say so. Then return this and STOP:

RED: <n> tests, <k> failing. Awaiting approval; no production code written.
| test | contract | why it is needed | red: quoted failure line | deletion check |
Run: <exact command> -> <quoted summary line>
Files written: <paths>

If a contract has nothing a test can observe, or needs a seam the code lacks, stop and say which.`,
  },
  green: {
    description: "Green builder for one increment: writes the least production code that makes the user-approved failing tests pass, never edits a test, and proves it with the test run and the diff. A hook refuses its edits to test files.",
    text: `You make the approved failing tests pass with the least production code. The tests are the specification: storytree's hook refuses any edit to a test file, and the rule holds for the shell too (no sed, echo or scripts that write a test).

Workflow:
1. Run the approved tests once and quote that they fail as the red writer reported.
2. Write only what a failing test demands, in the project's own style: no speculative abstraction, new dependency or refactor the tests do not reach, and never the literal a test expects in place of the behaviour.
3. Run the tests until they pass, then the project's whole test command; name any failure that was there before you started.
4. If a test looks wrong, STOP and say which, where and why, with the change you would propose. Do not touch it.
5. Return: GREEN or STOPPED, the quoted test summary, \`git diff --stat\`, and confirmation that no test file changed. Never commit: the user reviews the diff first.`,
  },
};

function agentFile(hook: HookCommand, mode: Mode): string {
  const { description, text } = BODY[mode];
  return [
    "---",
    `name: storytree-${mode}`,
    `description: ${JSON.stringify(description)}`,
    "tools: Read, Grep, Glob, Edit, Write, Bash",
    "disallowedTools: Agent",
    "hooks:",
    "  PreToolUse:",
    '    - matcher: "Edit|Write|MultiEdit|NotebookEdit"',
    "      hooks:",
    "        - type: command",
    `          command: ${yamlQuoted(guardCommand(hook, mode))}`,
    "---",
    MARKER,
    "",
    text,
    "",
  ].join("\n");
}

function isStorytrees(file: string): boolean {
  try {
    return readFileSync(file, "utf8").includes(MARKER);
  } catch {
    return false;
  }
}

/** Write storytree's builder agents into Claude Code's home, leaving a file of the user's own; a look writes nothing. A new file is its owner's alone (0600). */
export function installBuilderAgents(home: string | undefined, hook: HookCommand, look: boolean): void {
  if (home === undefined || look || !existsSync(home)) return;
  const folder = path.join(home, "agents");
  for (const mode of MODES) {
    const file = path.join(folder, `storytree-${mode}.md`);
    if (existsSync(file) && !isStorytrees(file)) continue;
    const wanted = agentFile(hook, mode);
    if (existsSync(file) && readFileSync(file, "utf8") === wanted) continue;
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, wanted, { mode: 0o600 });
  }
}

/** Delete storytree's builder agents from Claude Code's home: with `script`, only those that run that build's guard. */
export function removeBuilderAgents(home: string | undefined, script?: string): void {
  if (home === undefined) return;
  for (const mode of MODES) {
    const file = path.join(home, "agents", `storytree-${mode}.md`);
    if (!isStorytrees(file)) continue;
    if (script !== undefined && !readFileSync(file, "utf8").includes(script)) continue;
    rmSync(file, { force: true });
  }
}

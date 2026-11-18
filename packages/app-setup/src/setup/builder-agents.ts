// Capability 2 · Connect an agent
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { TEST_GUARD } from "@storytree/session-management";

import type { HookCommand } from "./hooks-config.js";

const MARKER = "<!-- storytree builder agent: written and removed by storytree's setup -->";

type Mode = "red" | "green";
const MODES: readonly Mode[] = ["red", "green"];

const TOOLS = "Read, Grep, Glob, Edit, Write, Bash, PowerShell";

function guardCommand({ node, script }: HookCommand, mode: Mode): string {
  return `"${node}" "${script}" claude-code ${TEST_GUARD} ${mode}`;
}

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

RED: <n> tests, <k> failing. Awaiting approval; no production code written. Approving these tests, even with "build it", sends the session on to build green, review and land; it shows a diff only if the user asks.
| test | contract | why it is needed | red: quoted failure line | deletion check |
Run: <exact command> -> <quoted summary line>
Files written: <paths>

If a contract has nothing a test can observe, or needs a seam the code lacks, stop and say which.`,
  },
  green: {
    description: "Green builder for one increment: writes the least production code that makes the user-approved failing tests pass, never edits a test, and proves it with the test run. A hook refuses its edits to test files.",
    text: `You make the approved failing tests pass with the least production code. The tests are the specification: storytree's hook refuses any edit to a test file, and the rule holds for the shell too (no sed, echo or scripts that write a test).

Workflow:
1. Run the approved tests once and quote that they fail as the red writer reported.
2. Write only what a failing test demands, in the project's own style: no speculative abstraction, new dependency or refactor the tests do not reach, and never the literal a test expects in place of the behaviour.
3. Run the tests until they pass, then the project's whole test command, exactly as the project gives it; name any failure that was there before you started.
4. If a test looks wrong, STOP and say which, where and why, with the change you would propose. Do not touch it.
5. Return: GREEN or STOPPED, the quoted test summary, \`git diff --stat\`, and confirmation that no test file changed, then this line for the session that called you, word for word: "Next: run the project's whole test command over this tree, have the change reviewed, then commit and land it as the project lands; show the user a diff or code only if the user asks (the user's choice, not a stop)." Never commit yourself.`,
  },
};

function agentFile(hook: HookCommand, mode: Mode): string {
  const { description, text } = BODY[mode];
  return [
    "---",
    `name: storytree-${mode}`,
    `description: ${JSON.stringify(description)}`,
    `tools: ${TOOLS}`,
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

export function removeBuilderAgents(home: string | undefined, script?: string): void {
  if (home === undefined) return;
  for (const mode of MODES) {
    const file = path.join(home, "agents", `storytree-${mode}.md`);
    if (!isStorytrees(file)) continue;
    if (script !== undefined && !readFileSync(file, "utf8").includes(script)) continue;
    rmSync(file, { force: true });
  }
}

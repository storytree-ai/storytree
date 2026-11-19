// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { RULES } from "./lint.mjs";
import { processMatchProblems, shellProblems } from "./process-match.mjs";

const FILE = "packages/app-setup/testing/linux-acceptance/self-update.sh";
const lines = (problems) => problems.map((problem) => {
  const found = /^(?<file>[^:]+):(?<line>\d+) /.exec(problem);
  assert.ok(found, `starts with <file>:<line>: ${problem}`);
  assert.equal(found.groups.file, FILE);
  assert.match(problem, /escape_24ab852d292f/);
  return Number(found.groups.line);
});
const unique = (numbers) => [...new Set(numbers)];

test("8.28 · pnpm lint's process-match rule refuses, in a tracked shell script, pkill -f, or pgrep -f with no listing flag (a or l), whose pattern does not start with ^, naming the file, the line and escape_24ab852d292f; an anchored pattern, pgrep -fa or -fl listing into evidence, and pgrep or pkill without -f pass", () => {
  const rule = RULES.find(({ name }) => name === "process-match");
  assert.ok(rule, RULES.map(({ name }) => name).join(", "));
  assert.equal(rule.problems, processMatchProblems);

  const refused = [
    `#!/bin/sh`,
    `  pgrep -f "$st_exe" >/dev/null 2>&1 || return 0`,
    `  while pgrep -f "$st_exe" >/dev/null 2>&1; do`,
    String.raw`pkill -TERM -f '\.local/share/storytree-0\.3/storytree-0\.3'`,
    String.raw`step quit sh -c "pkill -TERM -f '\.local/share/storytree-0\.3/storytree-0\.3'; exit 1"`,
    String.raw`step wait sh -c "for _ in \$(seq 1 30); do pgrep -f '\.local/share/storytree-0\.3/storytree-0\.3' > /dev/null || exit 0; sleep 2; done"`,
    `for _ in $(seq 1 30); do pgrep -f 'storytree-0.3.app/Contents/MacOS/storytree-0.3$' > /dev/null || break; sleep 2; done`,
    String.raw`step quit sh -c "pkill -TERM -f '\.local/share/storytree-0\.3/storytree-0\.3'; for _ in \$(seq 1 30); do pgrep -f '\.local/share/storytree-0\.3/storytree-0\.3' > /dev/null || exit 0; sleep 2; done; exit 1"`,
  ].join("\n");
  assert.deepEqual(unique(lines(shellProblems(FILE, refused))), [2, 3, 4, 5, 6, 7, 8]);

  const passing = [
    `#!/bin/sh`,
    `running() { pgrep -f "^$APP/Contents/MacOS/storytree-0.3\\$" > /dev/null; }`,
    String.raw`step quit sh -c "pkill -TERM -f '^$APP/storytree-0\.3( |\$)'; pgrep -f '^$APP/storytree-0\.3( |\$)' > /dev/null || exit 0"`,
    `step processes sh -c "pgrep -fa storytree; echo; pgrep -fa postgres"`,
    `step processes sh -c "pgrep -fl storytree; echo; pgrep -fl postgres"`,
    `pgrep -fa storytree`,
    `pgrep -fl postgres`,
    `pgrep -x ShipIt`,
    `pkill storytree`,
  ].join("\n");
  assert.deepEqual(shellProblems(FILE, passing), []);
});

test("8.28 · processMatchProblems reads only tracked .sh files: a tracked script's unanchored pgrep -f is one problem at its file and line, and an untracked script and a tracked non-script holding the same line are none", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "process-match-"));
  t.after(() => removeTemp(root));
  const offending = `#!/bin/sh\necho start\npgrep -f "$st_exe" >/dev/null || exit 0\n`;
  const files = { "scripts/stop.sh": offending, "scripts/loose.sh": offending, "docs/stop.md": offending };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "--", "scripts/stop.sh", "docs/stop.md"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });

  const problems = await processMatchProblems(root);
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /^scripts\/stop\.sh:3 /);
  assert.match(problems[0], /escape_24ab852d292f/);
});

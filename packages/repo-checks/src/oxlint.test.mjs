// Capability 8 · Storytree's own test and gate entries.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { lint, RULES } from "./lint.mjs";
import { oxlintProblems } from "./oxlint.mjs";

const REFUSED = "This comment's content goes to a decision or the library, not the code (ADR-1366, ADR-1369).";
const MOVE = String.raw`Any attack string /\s+/ plus some rejecting suffix will cause quadratic runtime because of this quantifier.`;
const GIT_FETCH = `passes an input-built argument to git fetch with no "--" before it (CodeQL's js/second-order-command-line-injection): a value opening with "-" is read as an option; put "--" before the first input-built argument`;
const PEAK = /peak memory \d+(?:\.\d+)? MB\b/;

function checkout(t, files, track = Object.keys(files)) {
  const root = mkdtempSync(path.join(tmpdir(), "oxlint-"));
  t.after(() => removeTemp(root));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  if (track.length > 0) execFileSync("git", ["add", "--", ...track], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return root;
}

const lines = (...each) => `${each.join("\n")}\n`;

test("8.32 · oxlintProblems runs storytree's rules and regexp/no-super-linear-move over tracked and untracked-not-ignored .mjs and .ts files, one line each naming file, line, rule and its message; a git-ignored file, a *.min.js, a .md file and a hatched comment give none; its one log line names 4 files and the peak memory in MB", async (t) => {
  const root = checkout(
    t,
    {
      ".gitignore": "dist/\n",
      "packages/a/src/trim.mjs": lines("// Capability 1 · Trim.", String.raw`export const trim = (text) => text.replace(/\s+$/, ""); // trims the tail`),
      "packages/b/src/typed.ts": lines(
        `export const fetchIt = (execFileSync: (c: string, a: string[]) => string, url: string) => execFileSync("git", ["fetch", url]);`,
        "/* why it fetches */",
      ),
      "packages/a/src/hatch.mjs": lines(
        "export const a = 1;",
        "// eslint-disable-next-line storytree/no-comments -- a tool reads this line",
        "// keep: this line",
      ),
      "packages/a/src/loose.mjs": lines("export const loose = 1;", "// narration never tracked"),
      "dist/out.js": lines("// ignored output", String.raw`export const x = (s) => s.replace(/\s+$/, "");`),
      "packages/a/src/vendor.min.js": String.raw`/* vendor */export const v=(s)=>s.replace(/\s+$/,"");` + "\n",
      "docs/notes.md": lines("// not code"),
    },
    [".gitignore", "packages/a/src/trim.mjs", "packages/b/src/typed.ts", "packages/a/src/hatch.mjs", "packages/a/src/vendor.min.js", "docs/notes.md"],
  );

  const logged = [];
  const problems = await oxlintProblems(root, { log: (line) => logged.push(line) });
  assert.deepEqual([...problems].sort(), [
    `packages/a/src/loose.mjs:2 storytree/no-comments: ${REFUSED}`,
    `packages/a/src/trim.mjs:2 regexp/no-super-linear-move: ${MOVE}`,
    `packages/a/src/trim.mjs:2 storytree/no-comments: ${REFUSED}`,
    `packages/b/src/typed.ts:1 storytree/git-end-of-options: ${GIT_FETCH}`,
    `packages/b/src/typed.ts:2 storytree/no-comments: ${REFUSED}`,
  ]);
  assert.equal(logged.length, 1, logged.join("\n"));
  assert.match(logged[0], /^oxlint /);
  assert.match(logged[0], /\b4 files\b/);
  assert.match(logged[0], PEAK);
});

test("8.32 · pnpm lint's last rule is named oxlint and runs oxlintProblems; on a tree no rule breaks it gives no problem, lint exits 0, and its summary line naming 2 files and the peak memory in MB reaches lint's log", async (t) => {
  const rule = RULES.at(-1);
  assert.equal(rule.name, "oxlint");
  assert.equal(rule.problems, oxlintProblems);

  const root = checkout(t, {
    "packages/a/src/clean.mjs": lines("// Capability 1 · Clean.", "export const fine = 1;"),
    "packages/b/src/typed.ts": lines("export const n: number = 1;"),
  });
  assert.deepEqual(await oxlintProblems(root), []);

  const logged = [];
  assert.equal(await lint({ root, rules: [rule], log: (line) => logged.push(line) }), 0);
  assert.equal(logged.length, 2, logged.join("\n"));
  assert.match(logged[0], /^oxlint /);
  assert.match(logged[0], /\b2 files\b/);
  assert.match(logged[0], PEAK);
  assert.equal(logged[1], "lint: clean (oxlint)");
});

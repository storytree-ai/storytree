// Capability 8 · Storytree's own test and gate entries. contract_328bafda205c (8.19, ADR-1370 D1, ADR-1366 D3): `pnpm lint`
// runs ESLint as its rule `eslint` over the checkout's tracked JavaScript and TypeScript files, with storytree's own rules
// loaded as a local plugin from packages/repo-checks/src/eslint-rules, every rule it exports on; each problem is one lint
// problem naming file, line, rule and message. A fake plugin stands in for the real one so a rule can be made to fire.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import storytreePlugin from "./eslint-rules/index.mjs";
import * as lintPackage from "./eslint.mjs";
import { eslintProblems } from "./eslint.mjs";
import { RULES } from "./lint.mjs";

const DEBUGGER_MESSAGE = "Remove this debugger statement before committing.";
const FORBIDDEN_MESSAGE = "Rename forbidden: the name is reserved.";

/** A local plugin with two rules and no config of its own: each rule it exports must be on without being named anywhere. */
const plugin = {
  meta: { name: "storytree" },
  rules: {
    "no-debugger-here": {
      meta: { type: "problem", schema: [] },
      create: (context) => ({ DebuggerStatement: (node) => context.report({ node, message: DEBUGGER_MESSAGE }) }),
    },
    "no-forbidden-name": {
      meta: { type: "problem", schema: [] },
      create: (context) => ({ Identifier: (node) => { if (node.name === "forbidden") context.report({ node, message: FORBIDDEN_MESSAGE }); } }),
    },
  },
};

/** A throwaway git checkout holding `files` (path → text); `track` lists the paths `git add`ed, the rest stay untracked. */
function checkout(t, files, track = Object.keys(files)) {
  const root = mkdtempSync(path.join(tmpdir(), "eslint-"));
  t.after(() => removeTemp(root));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  if (track.length > 0) execFileSync("git", ["add", "--", ...track], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  return root;
}

test("8.19 · pnpm lint's last rule is named eslint and runs eslintProblems", () => {
  const rule = RULES.at(-1);
  assert.equal(rule.name, "eslint");
  assert.equal(rule.problems, eslintProblems);
});

test("8.19 · each problem in a tracked .js, .mjs, .cjs, .ts, .tsx, .mts or .cts file is one line naming file, line, storytree/<rule> and the rule's message, every rule the plugin exports on with no config; a .md file is not read", async (t) => {
  const root = checkout(t, {
    "packages/a/src/bad.mjs": "export const ok = 1;\n\ndebugger;\nconst forbidden = 2;\n",
    "packages/a/src/two.js": "debugger;\n",
    "packages/a/src/old.cjs": "const x = require(\"x\");\nmodule.exports = x;\ndebugger;\n",
    "packages/b/src/typed.ts": "const n: number = 1;\nexport { n };\n\n\ndebugger;\n",
    "packages/b/src/view.tsx": "type Props = { name: string };\nexport const View = ({ name }: Props) => <p>{name}</p>;\ndebugger;\n",
    "packages/b/src/mod.mts": "export type Id = string;\ndebugger;\n",
    "packages/b/src/common.cts": "const forbidden: string = \"x\";\nexport = forbidden;\n",
    "docs/notes.md": "debugger;\n",
    "packages/a/src/clean.mjs": "export const fine = 1;\n",
  });

  const problems = await eslintProblems(root, { plugin });
  assert.deepEqual([...problems].sort(), [
    `packages/a/src/bad.mjs:3 storytree/no-debugger-here: ${DEBUGGER_MESSAGE}`,
    `packages/a/src/bad.mjs:4 storytree/no-forbidden-name: ${FORBIDDEN_MESSAGE}`,
    `packages/a/src/old.cjs:3 storytree/no-debugger-here: ${DEBUGGER_MESSAGE}`,
    `packages/a/src/two.js:1 storytree/no-debugger-here: ${DEBUGGER_MESSAGE}`,
    `packages/b/src/common.cts:1 storytree/no-forbidden-name: ${FORBIDDEN_MESSAGE}`,
    `packages/b/src/common.cts:2 storytree/no-forbidden-name: ${FORBIDDEN_MESSAGE}`,
    `packages/b/src/mod.mts:2 storytree/no-debugger-here: ${DEBUGGER_MESSAGE}`,
    `packages/b/src/typed.ts:5 storytree/no-debugger-here: ${DEBUGGER_MESSAGE}`,
    `packages/b/src/view.tsx:3 storytree/no-debugger-here: ${DEBUGGER_MESSAGE}`,
  ]);
});

test("8.19 · an untracked file, a git-ignored file and a tracked *.min.js are not read; only the tracked file's problem is reported", async (t) => {
  const root = checkout(
    t,
    {
      ".gitignore": "dist/\n",
      "packages/a/src/bad.mjs": "debugger;\n",
      "packages/a/src/loose.mjs": "debugger;\n",
      "dist/out.js": "debugger;\n",
      "docs/design/sketch/page.min.js": "debugger;const forbidden=1;\n",
    },
    [".gitignore", "packages/a/src/bad.mjs", "docs/design/sketch/page.min.js"],
  );

  assert.deepEqual(await eslintProblems(root, { plugin }), [`packages/a/src/bad.mjs:1 storytree/no-debugger-here: ${DEBUGGER_MESSAGE}`]);
});

test("8.19 · TypeScript syntax in .ts, .tsx, .mts and .cts parses with no problem, and a .mjs or .ts file that cannot parse is one problem naming its file, line and rule parse", async (t) => {
  const root = checkout(t, {
    "packages/b/src/types.ts": [
      "export interface Point { x: number; y: number }",
      "export const origin = { x: 0, y: 0 } as const satisfies Point;",
      "export function first<T>(items: readonly T[]): T | undefined { return items[0]; }",
      "export enum Colour { Red, Green }",
      "export abstract class Shape { protected abstract area(): number; }",
      "",
    ].join("\n"),
    "packages/b/src/view.tsx": "import type { Point } from \"./types.ts\";\nexport const Dot = ({ x, y }: Point) => <circle cx={x} cy={y} r={1} />;\n",
    "packages/b/src/ids.mts": "export type Id = `id_${string}`;\nexport const id = (raw: unknown): Id => raw as Id;\n",
    "packages/b/src/old.cts": "import fs = require(\"node:fs\");\nexport = fs;\n",
    "packages/a/src/broken.mjs": "export const ok = 1;\nconst = ;\n",
    "packages/b/src/broken.ts": "export const a = 1;\n\nlet b: = 2;\n",
  });

  const problems = [...(await eslintProblems(root, { plugin }))].sort();
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems[0], /^packages\/a\/src\/broken\.mjs:2 parse: Parsing error: \S/);
  assert.match(problems[1], /^packages\/b\/src\/broken\.ts:3 parse: Parsing error: \S/);
});

test("8.19 · the local plugin in packages/repo-checks/src/eslint-rules is an ESLint plugin named storytree, and a tree no rule breaks gives no problem, with the default plugin or a given one", async (t) => {
  assert.equal(storytreePlugin.meta.name, "storytree");
  assert.equal(typeof storytreePlugin.rules, "object");

  const root = checkout(t, {
    "packages/a/src/clean.mjs": "export const fine = 1;\n",
    "packages/b/src/typed.ts": "export const n: number = 1;\n",
  });
  assert.deepEqual(await eslintProblems(root), []);
  assert.deepEqual(await eslintProblems(root, { plugin }), []);
});

function branch(t, { base, main = {}, head = {}, uncommitted = {}, origin = true }) {
  const root = mkdtempSync(path.join(tmpdir(), "eslint-branch-"));
  t.after(() => removeTemp(root));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const write = (files) => {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
  };
  git("init", "-q", "-b", "work");
  write(base);
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "base");
  if (origin) {
    git("checkout", "-q", "-b", "main-side");
    write(main);
    git("add", "-A");
    git("commit", "-q", "--no-verify", "--allow-empty", "-m", "main moves on");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-q", "work");
  }
  write(head);
  git("add", "-A");
  git("commit", "-q", "--no-verify", "--allow-empty", "-m", "the branch");
  write(uncommitted);
  return root;
}

const lines = (...each) => `${each.join("\n")}\n`;
const NO_COMMENTS = /^(\S+:\d+) storytree\/no-comments: (.+)$/;

function refusedAt(problems) {
  return problems
    .map((problem) => {
      const match = NO_COMMENTS.exec(problem);
      assert.ok(match, `not a storytree/no-comments problem: ${problem}`);
      return match[1];
    })
    .sort();
}

test("8.20 · storytree/no-comments refuses each line, block, JSDoc and trailing comment on a line the branch adds, committed or not, in a source or test file, as <file>:<line> storytree/no-comments: saying its content goes to a decision or the library; a comment on a line of merge-base(origin/main, HEAD) is not refused, even one origin/main has since removed", async (t) => {
  const oldBase = lines(
    "// Capability 1 · Old things.",
    "// narration already on main",
    "export const old = 1; // trailing on main",
    "/* block on main */",
    "export const kept = 2;",
  );
  const oldHead = oldBase + lines(
    "// narration the branch adds",
    "export const added = 3; /* trailing block the branch adds */",
    "/** JSDoc the branch adds */",
    "export function f() {}",
  );
  const root = branch(t, {
    base: {
      "packages/a/src/old.mjs": oldBase,
      "packages/a/src/gone.mjs": lines("export const g = 1;", "// main removes this later"),
    },
    main: { "packages/a/src/gone.mjs": lines("export const g = 1;") },
    head: {
      "packages/a/src/old.mjs": oldHead,
      "packages/b/src/new.ts": lines("// Capability 2 · New things.", "const n: number = 1; // why n is one", "export { n };"),
      "packages/b/src/new.test.mjs": lines("import { test } from \"node:test\";", "// a test file's narration", "test(\"x\", () => {});"),
    },
    uncommitted: { "packages/a/src/old.mjs": oldHead + lines("// uncommitted narration") },
  });

  const problems = await eslintProblems(root);
  assert.deepEqual(refusedAt(problems), [
    "packages/a/src/old.mjs:6",
    "packages/a/src/old.mjs:7",
    "packages/a/src/old.mjs:8",
    "packages/a/src/old.mjs:10",
    "packages/b/src/new.ts:2",
    "packages/b/src/new.test.mjs:2",
  ].sort());
  for (const problem of problems) assert.match(problem, /goes to a decision or the library/);
});

test("8.20 · where merge-base(origin/main, HEAD) cannot be read, with no origin/main or with no commit at all, every line counts as added and its comment outside the kept set is refused", async (t) => {
  const committed = branch(t, {
    origin: false,
    base: { "packages/a/src/a.mjs": lines("// Capability 1 · A.", "// narration in the first commit", "export const a = 1;") },
  });
  assert.deepEqual(refusedAt(await eslintProblems(committed)), ["packages/a/src/a.mjs:2"]);

  const uncommitted = checkout(t, { "packages/a/src/a.mjs": lines("export const a = 1;", "/* narration never committed */") });
  assert.deepEqual(refusedAt(await eslintProblems(uncommitted)), ["packages/a/src/a.mjs:2"]);
});

test("8.20 · on added lines the kept set passes: a file's opening Capability N · declaration (after a #! line), a pause marker beginning by naming the wait and saying it is the behaviour under test, ESLint directives, @ts-expect-error, @ts-ignore and /// <reference/>; a Capability comment after code, or after the file's first comment, a posix-only: <reason> marker and a comment merely mentioning under test are refused", async (t) => {
  const root = checkout(t, {
    "packages/a/src/script.mjs": lines(
      "#!/usr/bin/env node",
      "// Capability 3 · A script.",
      "export const p = 1;",
      "// posix-only: ps has no Windows twin here",
      "export const q = 2;",
      "// eslint-disable-next-line no-console -- prints the list",
      "console.log(\"x\");",
      "/* global window */",
      "export const w = typeof window;",
    ),
    "packages/a/src/wait.test.mjs": lines(
      "// Capability 3 · Waits.",
      "import { test } from \"node:test\";",
      "test(\"x\", async () => {",
      "  // the wait is the behaviour under test",
      "  await new Promise((resolve) => setTimeout(resolve, 5));",
      "});",
      "test(\"y\", async () => {",
      "  // the delay is the behaviour under test",
      "  await new Promise((resolve) => setTimeout(resolve, 5));",
      "});",
    ),
    "packages/b/src/ref.ts": lines("/// <reference types=\"node\" />", "export const ref = 1;"),
    "packages/b/src/typed.ts": lines(
      "// Capability 4 · Typed.",
      "// @ts-expect-error the value is a string on purpose",
      "export const n: number = \"x\";",
      "// @ts-ignore",
      "export const m: number = \"y\";",
    ),
    "packages/b/src/late.mjs": lines("export const a = 1;", "// Capability 5 · After code."),
    "packages/b/src/second.mjs": lines("// Capability 6 · First.", "// Capability 6 · Second.", "export const b = 1;"),
    "packages/b/src/continued.mjs": lines("// Capability 7 · Continued.", "// and a second line of it", "export const c = 1;"),
    "packages/a/src/helper.test.mjs": lines(
      "// Capability 3 · Helpers.",
      "import { test } from \"node:test\";",
      "// the helper under test returns its input",
      "test(\"x\", () => {});",
    ),
  });

  assert.deepEqual(refusedAt(await eslintProblems(root)), [
    "packages/a/src/helper.test.mjs:3",
    "packages/a/src/script.mjs:4",
    "packages/b/src/continued.mjs:2",
    "packages/b/src/late.mjs:2",
    "packages/b/src/second.mjs:2",
  ]);
});

test("8.21 · // eslint-disable-next-line storytree/no-comments -- <reason> keeps the next line's comment, and commentHatches lists each such hatch on a line the branch adds as { file, line of the kept comment, the comment's text, the reason }; one on merge-base(origin/main, HEAD) is not listed", async (t) => {
  const oldBase = lines(
    "export const a = 1;",
    "// eslint-disable-next-line storytree/no-comments -- on main already",
    "// a comment main keeps",
  );
  const root = branch(t, {
    base: { "packages/a/src/old.mjs": oldBase },
    head: {
      "packages/a/src/old.mjs": oldBase + lines(
        "// eslint-disable-next-line storytree/no-comments -- the regex reads backwards without it",
        "// matches the tail first",
        "export const re = /a$/;",
      ),
      "packages/b/src/new.ts": lines(
        "export const n = 1;",
        "// eslint-disable-next-line storytree/no-comments -- a tool reads this block",
        "/* keep: block */",
      ),
    },
  });

  assert.deepEqual(await eslintProblems(root), []);
  const hatches = [...(await lintPackage.commentHatches(root))].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  assert.deepEqual(hatches, [
    { file: "packages/a/src/old.mjs", line: 5, comment: "matches the tail first", reason: "the regex reads backwards without it" },
    { file: "packages/b/src/new.ts", line: 3, comment: "keep: block", reason: "a tool reads this block" },
  ]);
});

test("8.21 · a next-line disable of storytree/no-comments with no -- <reason> is one problem at its line saying it needs a reason; an eslint-disable-line, a block eslint-disable naming it and a disable naming no rule are each one problem at their line saying only a next-line disable with a reason keeps a comment; none is a hatch", async (t) => {
  const root = checkout(t, {
    "packages/a/src/bare.mjs": lines("export const a = 1;", "// eslint-disable-next-line storytree/no-comments", "// kept without a reason"),
    "packages/a/src/line.mjs": lines("export const a = 1; // eslint-disable-line storytree/no-comments -- why"),
    "packages/a/src/block.mjs": lines(
      "/* eslint-disable storytree/no-comments -- the whole file */",
      "// narration hidden below",
      "export const a = 1;",
      "/* eslint-enable storytree/no-comments */",
    ),
    "packages/a/src/all.mjs": lines("/* eslint-disable */", "// narration hidden by a bare disable", "export const a = 1;"),
    "packages/a/src/next-all.mjs": lines("export const a = 1;", "// eslint-disable-next-line -- a reason but no rule", "// hidden by it"),
  });

  const problems = await eslintProblems(root);
  const at = (location) => problems.filter((problem) => problem.startsWith(`${location} `));
  const ONLY_NEXT_LINE = /only a next-line disable with a reason keeps a comment/;
  const expected = {
    "packages/a/src/bare.mjs:2": /needs a reason/,
    "packages/a/src/line.mjs:1": ONLY_NEXT_LINE,
    "packages/a/src/block.mjs:1": ONLY_NEXT_LINE,
    "packages/a/src/all.mjs:1": ONLY_NEXT_LINE,
    "packages/a/src/next-all.mjs:2": ONLY_NEXT_LINE,
  };
  for (const [location, message] of Object.entries(expected)) {
    const found = at(location);
    assert.equal(found.length, 1, `${location}: ${problems.join("\n")}`);
    assert.match(found[0], NO_COMMENTS);
    assert.match(found[0], message);
  }
  assert.doesNotMatch(at("packages/a/src/bare.mjs:2")[0], ONLY_NEXT_LINE);
  assert.deepEqual([...(await lintPackage.commentHatches(root))], []);
});

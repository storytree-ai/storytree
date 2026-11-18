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

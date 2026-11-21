// Capability 8 · Storytree's own test and gate entries.
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { removeTemp } from "@storytree/test-waits";

import storytreePlugin from "./eslint-rules/index.mjs";
import { lint, RULES } from "./lint.mjs";
import * as oxlint from "./oxlint.mjs";
import { oxlintProblems } from "./oxlint.mjs";

const REFUSED = "This comment's content goes to a decision or the library, not the code (ADR-1366, ADR-1369).";
const MOVE = String.raw`Any attack string /\s+/ plus some rejecting suffix will cause quadratic runtime because of this quantifier.`;
const GIT_FETCH = `passes an input-built argument to git fetch with no "--" before it (CodeQL's js/second-order-command-line-injection): a value opening with "-" is read as an option; put "--" before the first input-built argument`;
const UNPLACED = `runs the write "storytree arc new" naming no place: a write naming none of "--project", "--arc" or "--increment" is refused (ADR-1348 D3, escape_d6cd4011df60); pass one of them`;
const PEAK =/peak memory \d+(?:\.\d+)? MB\b/;

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

test("8.32 · under oxlintProblems storytree/write-names-place reads storytree's writes: a tracked .mjs whose argv array spells arc new with no --project, --arc or --increment is one problem naming its file, line, the rule and its message", async (t) => {
  const root = checkout(t, {
    "packages/a/src/park.mjs": lines("export const kept = 1;", `export const parked = (t) => ["arc", "new", "--title", t];`),
  });

  assert.deepEqual(await oxlintProblems(root), [
    `packages/a/src/park.mjs:2 storytree/write-names-place: ${UNPLACED}`,
  ]);
});

test("8.32 · when Oxlint does not finish its report, oxlintProblems fails with one problem saying so, how it ended and the last of Oxlint's own error output: a process that writes an error and exits 3 names exit status 3 and that error, and a root that does not exist names the spawn error and no output", async (t) => {
  const root = checkout(t, {
    "crash.cjs": lines(`process.stderr.write("\\nOxlint cannot start here\\n");`, "process.exit(3);"),
    "packages/a/src/clean.mjs": lines("export const fine = 1;"),
  });
  const previous = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `${previous ?? ""} --require ./crash.cjs`;
  let crashed;
  try {
    crashed = await oxlintProblems(root);
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previous;
  }
  assert.deepEqual(crashed, ["Oxlint did not finish (exit status 3): Oxlint cannot start here"]);

  const missing = await oxlintProblems(path.join(root, "missing"));
  assert.equal(missing.length, 1, missing.join("\n"));
  assert.match(missing[0], /^Oxlint did not finish \(spawnSync .+ ENOENT\): no output$/);
});

test("8.32 · a tree with no source file gives no problem from oxlintProblems, and its one log line names 0 files and the peak memory in MB", async (t) => {
  const root = checkout(t, { "docs/notes.md": lines("# Notes") });

  const logged = [];
  assert.deepEqual(await oxlintProblems(root, { log: (line) => logged.push(line) }), []);
  assert.equal(logged.length, 1, logged.join("\n"));
  assert.match(logged[0], /^oxlint /);
  assert.match(logged[0], /\b0 files\b/);
  assert.match(logged[0], PEAK);
});

const UNREADABLE_SKIP = process.platform === "win32" ? "posix-only: chmod cannot deny reading a file on Windows" : process.getuid?.() === 0 ? "posix-only: root reads a mode-000 file" : false;

test("8.32 · a source file Oxlint cannot open, a diagnostic with no file name and no labels, is one problem holding Oxlint's own message, and oxlintProblems does not throw", { skip: UNREADABLE_SKIP }, async (t) => {
  const root = checkout(t, { "packages/a/src/locked.mjs": lines("export const locked = 1;") });
  const locked = path.join(root, "packages", "a", "src", "locked.mjs");
  chmodSync(locked, 0o000);
  let problems;
  try {
    problems = await oxlintProblems(root);
  } finally {
    chmodSync(locked, 0o600);
  }
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /Failed to open file .*locked\.mjs/);
  assert.match(problems[0], /Permission denied/);
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

const refusedIn = (...locations) => locations.map((location) => `${location} storytree/no-comments: ${REFUSED}`).sort();

test("8.19 · each problem in a tracked .js, .mjs, .cjs, .ts, .tsx, .mts or .cts file is one line naming file, line, storytree/<rule> and the rule's message, read with TypeScript and JSX syntax where the kind has it; a .md file is not read", async (t) => {
  const root = checkout(t, {
    "packages/a/src/bad.mjs": lines("export const ok = 1;", "", "// one"),
    "packages/a/src/two.js": lines("// two"),
    "packages/a/src/old.cjs": lines(`const x = require("x");`, "module.exports = x;", "// three"),
    "packages/b/src/typed.ts": lines("const n: number = 1;", "export { n };", "", "", "// four"),
    "packages/b/src/view.tsx": lines("type Props = { name: string };", "export const View = ({ name }: Props) => <p>{name}</p>;", "// five"),
    "packages/b/src/mod.mts": lines("export type Id = string;", "// six"),
    "packages/b/src/common.cts": lines(`const kept: string = "x";`, "export = kept; // seven"),
    "docs/notes.md": lines("// not code"),
    "packages/a/src/clean.mjs": lines("export const fine = 1;"),
  });

  assert.deepEqual([...(await oxlintProblems(root))].sort(), refusedIn(
    "packages/a/src/bad.mjs:3",
    "packages/a/src/old.cjs:3",
    "packages/a/src/two.js:1",
    "packages/b/src/common.cts:2",
    "packages/b/src/mod.mts:2",
    "packages/b/src/typed.ts:5",
    "packages/b/src/view.tsx:3",
  ));
});

test("8.19 · an untracked, not ignored file is read alongside the tracked one; a git-ignored file and a tracked or untracked *.min.js are not read", async (t) => {
  const root = checkout(
    t,
    {
      ".gitignore": "dist/\n",
      "packages/a/src/bad.mjs": lines("// tracked"),
      "packages/a/src/loose.mjs": lines("export const loose = 1;", "// untracked"),
      "dist/out.js": lines("// ignored"),
      "docs/design/sketch/page.min.js": lines("/* tracked bundle */var a=1;"),
      "packages/a/src/vendor.min.js": lines("/* untracked bundle */var a=1;"),
    },
    [".gitignore", "packages/a/src/bad.mjs", "docs/design/sketch/page.min.js"],
  );

  assert.deepEqual([...(await oxlintProblems(root))].sort(), refusedIn("packages/a/src/bad.mjs:1", "packages/a/src/loose.mjs:2"));
});

test("8.19 · TypeScript syntax in .ts, .tsx, .mts and .cts parses with no problem, and a .mjs or .ts file that cannot parse is one problem naming its file, line and rule parse", async (t) => {
  const root = checkout(t, {
    "packages/b/src/types.ts": lines(
      "export interface Point { x: number; y: number }",
      "export const origin = { x: 0, y: 0 } as const satisfies Point;",
      "export function first<T>(items: readonly T[]): T | undefined { return items[0]; }",
      "export enum Colour { Red, Green }",
      "export abstract class Shape { protected abstract area(): number; }",
    ),
    "packages/b/src/view.tsx": lines(`import type { Point } from "./types.ts";`, "export const Dot = ({ x, y }: Point) => <circle cx={x} cy={y} r={1} />;"),
    "packages/b/src/ids.mts": lines("export type Id = `id_${string}`;", "export const id = (raw: unknown): Id => raw as Id;"),
    "packages/b/src/old.cts": lines(`import fs = require("node:fs");`, "export = fs;"),
    "packages/a/src/broken.mjs": lines("export const ok = 1;", "const = ;"),
    "packages/b/src/broken.ts": lines("export const a = 1;", "", "let b: = 2;"),
  });

  const problems = [...(await oxlintProblems(root))].sort();
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems[0], /^packages\/a\/src\/broken\.mjs:2 parse: \S/);
  assert.match(problems[1], /^packages\/b\/src\/broken\.ts:3 parse: \S/);
});

test("8.19 · the local plugin in packages/repo-checks/src/eslint-rules is a plugin named storytree, every rule it exports is on with regexp's two beside them, and a tree no rule breaks gives no problem", async (t) => {
  assert.equal(storytreePlugin.meta.name, "storytree");
  const ruleCount = Object.keys(storytreePlugin.rules).length;

  const root = checkout(t, {
    "packages/a/src/clean.mjs": lines("export const fine = 1;"),
    "packages/b/src/typed.ts": lines("export const n: number = 1;"),
  });
  const logged = [];
  assert.deepEqual(await oxlintProblems(root, { log: (line) => logged.push(line) }), []);
  assert.equal(logged.length, 1, logged.join("\n"));
  assert.match(logged[0], new RegExp(`\\b${ruleCount + 2} rules\\b`));
});

test("8.19 · storytree's lint carries no ESLint: packages/repo-checks depends on none of eslint, typescript-eslint and typescript, no file under packages/repo-checks/src imports them, and the root pnpm-lock.yaml locks no eslint, typescript-eslint, @typescript-eslint/* or TypeScript but 7.x", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const depended = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap((field) => Object.keys(manifest[field] ?? {}));
  assert.deepEqual(depended.filter((name) => ["eslint", "typescript-eslint", "typescript"].includes(name) || name.startsWith("@typescript-eslint/")), []);

  const source = fileURLToPath(new URL(".", import.meta.url));
  const files = readdirSync(source, { recursive: true }).map(String).filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));
  assert.ok(files.length > 50, `${files.length} files`);
  const IMPORTS = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\(\s*)["'](eslint|typescript-eslint|typescript|@typescript-eslint\/[^"']+)["']/g;
  const importing = files.flatMap((file) => [...readFileSync(path.join(source, file), "utf8").matchAll(IMPORTS)].map((found) => `${file.split(path.sep).join("/")} imports ${found[1]}`));
  assert.deepEqual(importing, []);

  const lock = readFileSync(new URL("../../../pnpm-lock.yaml", import.meta.url), "utf8");
  const LOCKED = /^ {2}'?((?:eslint|typescript-eslint|@typescript-eslint\/[^@\s]+|typescript)@(?!7\.)[^:'\s]*)'?:/gm;
  assert.deepEqual([...lock.matchAll(LOCKED)].map((found) => found[1]), []);
});

function branch(t, { base, main = {}, head = {}, uncommitted = {}, origin = true }) {
  const root = mkdtempSync(path.join(tmpdir(), "oxlint-branch-"));
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

test("8.20 · storytree/no-comments refuses each line, block, JSDoc and trailing comment outside the kept set on every line of a tracked source or test file, whether on merge-base(origin/main, HEAD), even one origin/main has since removed, or added by the branch, committed or not, as <file>:<line> storytree/no-comments: saying its content goes to a decision or the library", async (t) => {
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

  const problems = await oxlintProblems(root);
  assert.deepEqual(refusedAt(problems), [
    "packages/a/src/gone.mjs:2",
    "packages/a/src/old.mjs:2",
    "packages/a/src/old.mjs:3",
    "packages/a/src/old.mjs:4",
    "packages/a/src/old.mjs:6",
    "packages/a/src/old.mjs:7",
    "packages/a/src/old.mjs:8",
    "packages/a/src/old.mjs:10",
    "packages/b/src/new.ts:2",
    "packages/b/src/new.test.mjs:2",
  ].sort());
  for (const problem of problems) assert.match(problem, /goes to a decision or the library/);
});

test("8.20 · where merge-base(origin/main, HEAD) cannot be read, with no origin/main or with no commit at all, a comment outside the kept set is still refused", async (t) => {
  const committed = branch(t, {
    origin: false,
    base: { "packages/a/src/a.mjs": lines("// Capability 1 · A.", "// narration in the first commit", "export const a = 1;") },
  });
  assert.deepEqual(refusedAt(await oxlintProblems(committed)), ["packages/a/src/a.mjs:2"]);

  const uncommitted = checkout(t, { "packages/a/src/a.mjs": lines("export const a = 1;", "/* narration never committed */") });
  assert.deepEqual(refusedAt(await oxlintProblems(uncommitted)), ["packages/a/src/a.mjs:2"]);
});

test("8.20 · the kept set passes: a file's opening Capability N · declaration (after a #! line), a pause marker beginning by naming the wait and saying it is the behaviour under test, the eslint- and oxlint- disable directives Oxlint reads, @ts-expect-error, @ts-ignore and /// <reference/>; a Capability comment after code, or after the file's first comment, a posix-only: <reason> marker, a /* global */ config comment no linter reads and a comment merely mentioning under test are refused", async (t) => {
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
      "// oxlint-disable-next-line no-console -- prints the count",
      "console.log(w);",
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

  assert.deepEqual(refusedAt(await oxlintProblems(root)), [
    "packages/a/src/helper.test.mjs:3",
    "packages/a/src/script.mjs:4",
    "packages/a/src/script.mjs:8",
    "packages/b/src/continued.mjs:2",
    "packages/b/src/late.mjs:2",
    "packages/b/src/second.mjs:2",
  ]);
});

test("8.21 · // eslint-disable-next-line storytree/no-comments -- <reason>, or its oxlint-disable-next-line spelling, keeps the next line's comment, and commentHatches lists each such hatch on a line the branch adds as { file, line of the kept comment, the comment's text, the reason }; one on merge-base(origin/main, HEAD) is not listed", async (t) => {
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
      "packages/c/src/spelled.mjs": lines(
        "export const s = 1;",
        "// oxlint-disable-next-line storytree/no-comments -- Oxlint's own spelling",
        "// keep: oxlint spelling",
      ),
    },
  });

  assert.deepEqual(await oxlintProblems(root), []);
  const hatches = [...(await oxlint.commentHatches(root))].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  assert.deepEqual(hatches, [
    { file: "packages/a/src/old.mjs", line: 5, comment: "matches the tail first", reason: "the regex reads backwards without it" },
    { file: "packages/b/src/new.ts", line: 3, comment: "keep: block", reason: "a tool reads this block" },
    { file: "packages/c/src/spelled.mjs", line: 3, comment: "keep: oxlint spelling", reason: "Oxlint's own spelling" },
  ]);
});

test("8.21 · a branch that adds only the disable directive above a comment already on merge-base(origin/main, HEAD) has commentHatches list that hatch once as { file, line of the kept comment, the comment's text, the reason }; a hatch with directive and comment both on the merge-base is not listed though the branch adds the line after it", async (t) => {
  const root = branch(t, {
    base: {
      "packages/a/src/swept.mjs": lines(
        "export const a = 1;",
        "// a comment main keeps",
        "// eslint-disable-next-line storytree/no-comments -- on main already",
        "// kept on main",
        "export const b = 2;",
      ),
    },
    head: {
      "packages/a/src/swept.mjs": lines(
        "export const a = 1;",
        "// eslint-disable-next-line storytree/no-comments -- a tool reads this line",
        "// a comment main keeps",
        "// eslint-disable-next-line storytree/no-comments -- on main already",
        "// kept on main",
        "export const c = 3;",
        "export const b = 2;",
      ),
    },
  });

  assert.deepEqual([...(await oxlint.commentHatches(root))], [
    { file: "packages/a/src/swept.mjs", line: 3, comment: "a comment main keeps", reason: "a tool reads this line" },
  ]);
});

test("8.21 · a next-line disable of storytree/no-comments with no -- <reason> is one problem at its line saying it needs a reason; an eslint-disable-line, a block eslint-disable naming it and a disable naming no rule are each one problem at their line saying only a next-line disable with a reason keeps a comment, though the disable would silence it; none is a hatch", async (t) => {
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

  const problems = await oxlintProblems(root);
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
  assert.deepEqual([...(await oxlint.commentHatches(root))], []);
});

const BACKTRACKING = "regexp/no-super-linear-backtracking";
const SAYS = { [BACKTRACKING]: /can exchange characters with/, "regexp/no-super-linear-move": /quadratic runtime/ };

test("8.18 · pnpm lint's Oxlint step refuses PR #989's regexes /^(.*)\\{(.*) => (.*)\\}(.*)$/ and /^\\s*(\\d+)\\s*([dw]?)\\s*$/i by regexp/no-super-linear-backtracking and a trailing trim /\\s+$/ by regexp/no-super-linear-move, in a source or a test file, each one line naming file, line, the rule and its message; /^([^{]*)\\{([^}]*)\\}$/, .trimEnd(), a tracked *.min.js and a next-line disable naming the rule with a reason give no problem", async (t) => {
  const root = checkout(t, {
    "packages/a/src/churn.ts": lines(
      String.raw`export const renamed = (path: string) => /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);`,
      String.raw`export const window = (text: string) => /^\s*(\d+)\s*([dw]?)\s*$/i.exec(text);`,
      String.raw`export const trimmed = (text: string) => text.replace(/\s+$/, "");`,
    ),
    "packages/a/src/churn.test.mjs": lines("export const kept = 1;", String.raw`export const trimmed = (text) => text.replace(/\s+$/, "");`),
    "packages/a/src/fixed.ts": lines(
      String.raw`export const renamed = (path: string) => /^([^{]*)\{([^}]*)\}$/.exec(path);`,
      "export const trimmed = (text: string) => text.trimEnd();",
    ),
    "packages/a/src/hatched.mjs": lines(
      "export const kept = 1;",
      "// eslint-disable-next-line regexp/no-super-linear-move -- the text is one short line the program wrote",
      String.raw`export const trimmed = (text) => text.replace(/\s+$/, "");`,
    ),
    "docs/design/sketch/page.min.js": String.raw`var t=function(s){return/^(.*)\{(.*)\}(.*)$/.exec(s)||s.replace(/\s+$/,"")};export{t};` + "\n",
  });

  const problems = [...(await oxlintProblems(root))].sort();
  const refused = problems.map((problem) => {
    const match = /^(\S+) (regexp\/[a-z-]+): (.+)$/.exec(problem);
    assert.ok(match, `not a regexp problem: ${problem}`);
    assert.match(match[3], SAYS[match[2]], problem);
    return `${match[1]} ${match[2]}`;
  });
  assert.deepEqual(refused, [
    "packages/a/src/churn.test.mjs:2 regexp/no-super-linear-move",
    `packages/a/src/churn.ts:1 ${BACKTRACKING}`,
    `packages/a/src/churn.ts:1 ${BACKTRACKING}`,
    `packages/a/src/churn.ts:2 ${BACKTRACKING}`,
    "packages/a/src/churn.ts:3 regexp/no-super-linear-move",
  ], problems.join("\n"));
});

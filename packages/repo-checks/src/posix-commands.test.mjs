// Capability 8 · Storytree's own test and gate entries. increment_68cf8ee865c6 (arc_a8103c0577a8, ADR-1356 D1, D5):
// `pnpm lint` refuses a POSIX-only process command (ps, lsof, pgrep, pkill) run with no platform branch around it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { posixCommandProblems } from "./posix-commands.mjs";

/** A checkout holding `files`, each path to its lines, removed when `t` ends. */
function checkout(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "posix-commands-"));
  t.after(() => removeTemp(root));
  for (const [file, lines] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), lines.join("\n"));
  }
  return root;
}

const COMMANDS = ["ps", "lsof", "pgrep", "pkill"];

/** Each problem's `file:line` and the one POSIX-only command it names, quoted (in "…" or `…`). */
const where = (problems) =>
  problems
    .map((problem) => {
      const at = problem.match(/^(\S+:\d+)\b/)?.[1] ?? `<no file:line in: ${problem}>`;
      const named = COMMANDS.filter((command) => new RegExp(`["\`]${command}["\`]`).test(problem));
      return `${at} ${named.join("|")}`;
    })
    .sort();

const HEADER = [
  `import { execFile, execFileSync, execSync, spawnSync } from "node:child_process";`,
  `import { promisify } from "node:util";`,
  `const run = promisify(execFile);`,
];

test("8.16 · pnpm lint refuses ps, lsof, pgrep or pkill run with no platform branch in a package's or app's source, naming file, line, command and escape_3d876fe9f3df, and saying to branch on process.platform or mark the line before it // posix-only: <why>", (t) => {
  const root = checkout(t, {
    "packages/procs/src/scan.mjs": [
      ...HEADER, // 1-3
      `export const scan = async (name, since) => {`, // 4
      `  const { stdout } = await run("ps", ["-eo", "pid=,args="], { maxBuffer: 64 * 1024 * 1024 });`, // 5
      `  return stdout;`, // 6
      `};`, // 7
      `export const holders = (port) => execFileSync("lsof", ["-i", ":" + port]);`, // 8
      `export const find = () => execSync("ps -eo pid,args");`, // 9
      `// posix-only:`, // 10
      `export const stop = (pid) => run("pkill", ["-P", String(pid)]);`, // 11
      `export async function look(name) {`, // 12
      `  if (name === "") return [];`, // 13
      `  return run("pgrep", [name]);`, // 14
      `}`, // 15
      `export const ready = (on) => (on ? run("ps", ["-A"]) : null);`, // 16
      "",
    ],
    "apps/desk/src/main.ts": [
      `import { spawnSync } from "node:child_process";`, // 1
      `export const all = (): Buffer => spawnSync("ps", ["-A"]).stdout;`, // 2
      "",
    ],
  });

  const problems = posixCommandProblems(root);
  assert.deepEqual(where(problems), [
    "apps/desk/src/main.ts:2 ps",
    "packages/procs/src/scan.mjs:11 pkill",
    "packages/procs/src/scan.mjs:14 pgrep",
    "packages/procs/src/scan.mjs:16 ps",
    "packages/procs/src/scan.mjs:5 ps",
    "packages/procs/src/scan.mjs:8 lsof",
    "packages/procs/src/scan.mjs:9 ps",
  ]);
  for (const problem of problems) {
    assert.match(problem, /escape_3d876fe9f3df/, problem);
    assert.match(problem, /process\.platform/, problem);
    assert.match(problem, /\/\/ posix-only: /, problem);
  }
});

test("8.16 · a POSIX-only command under a platform test (ternary, if, else if, logical, or an earlier if in its block, by platform, win32 or windows), marked // posix-only: <why>, in a test file, node_modules or dist, or a non-POSIX command (git, psql) passes", (t) => {
  const root = checkout(t, {
    "packages/procs/src/branched.mjs": [
      ...HEADER,
      `export const list = (platform) => (platform === "win32" ? run("tasklist", []) : run("ps", ["-A"]));`,
      `export function open(pid) {`,
      `  if (process.platform === "win32") {`,
      `    return run("tasklist", []);`,
      `  } else if (process.platform === "darwin") {`,
      `    execFileSync("ps", ["-p", String(pid)]);`,
      `  }`,
      `}`,
      `export const some = () => process.platform !== "win32" && run("pgrep", ["node"]);`,
      `export async function pids() {`,
      `  if (process.platform === "win32") return [];`,
      `  return run("ps", ["-eo", "pid="]);`,
      `}`,
      `export async function holders(port, windows = process.platform === "win32") {`,
      `  if (windows) return run("netstat", ["-ano"]);`,
      `  const { stdout } = await run("lsof", ["-i", ":" + port]);`,
      `  return stdout;`,
      `}`,
      `// posix-only: runs only on the Mint box`,
      `export const box = () => run("pkill", ["-f", "watch.mjs"]);`,
      `export const head = () => execFileSync("git", ["rev-parse", "HEAD"]);`,
      `export const status = () => execSync("git status");`,
      `export const query = () => run("psql", ["-c", "select 1"]);`,
      `export const shell = () => execSync("psql -c 1");`,
      "",
    ],
    "packages/procs/src/scan.test.mjs": [...HEADER, `run("ps", ["-A"]);`, ""],
    "apps/desk/src/main.test.ts": [`import { spawnSync } from "node:child_process";`, `spawnSync("lsof", []);`, ""],
    "packages/procs/node_modules/dep/src/index.js": [...HEADER, `run("ps", ["-A"]);`, ""],
    "packages/procs/dist/index.js": [...HEADER, `run("ps", ["-A"]);`, ""],
  });

  assert.deepEqual(posixCommandProblems(root), []);
});

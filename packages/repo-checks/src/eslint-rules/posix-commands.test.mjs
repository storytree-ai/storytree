// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import { ruleHits } from "../eslint.mjs";
import plugin from "./index.mjs";

const rule = plugin.rules["posix-commands"];
const at = (file) => path.join(process.cwd(), file);
const SOURCE = at("packages/procs/src/scan.mjs");
const HEADER = [
  `import { exec, execFile, execFileSync, execSync, spawnSync } from "node:child_process";`,
  `import { promisify } from "node:util";`,
  `const run = promisify(execFile);`,
].join("\n");
const source = (...lines) => [HEADER, ...lines].join("\n");
const refused = (command, line, code, filename = SOURCE) => ({ code, filename, errors: [{ messageId: "unbranched", data: { command }, line }] });
const passes = (code, filename = SOURCE) => ({ code, filename });

test("8.16 · storytree/posix-commands refuses ps, lsof, pgrep or pkill as a call's first string argument or the first word of an exec or execSync command string, optional calls and TypeScript included, with no platform branch around it (a non-platform ternary or earlier if, or an old // posix-only: line, is none), its message naming the command, escape_3d876fe9f3df, a process.platform branch and // eslint-disable-next-line storytree/posix-commands -- <why>", () => {
  const message = rule?.meta?.messages?.unbranched ?? "";
  assert.match(message, /\{\{\s*command\s*\}\}/, "names the command");
  assert.match(message, /escape_3d876fe9f3df/);
  assert.match(message, /process\.platform/);
  assert.match(message, /\/\/ eslint-disable-next-line storytree\/posix-commands -- /);

  new RuleTester().run("posix-commands", rule, {
    valid: [],
    invalid: [
      refused("ps", 5, source(`export const scan = async () => {`, `  const { stdout } = await run("ps", ["-eo", "pid=,args="], { maxBuffer: 64 * 1024 * 1024 });`, `  return stdout;`, `};`)),
      refused("lsof", 4, source(`export const holders = (port) => execFileSync("lsof", ["-i", ":" + port]);`)),
      refused("ps", 4, source(`export const find = () => execSync("ps -eo pid,args");`)),
      refused("pkill", 4, source(`export const stop = () => exec("pkill -f watch.mjs");`)),
      refused("lsof", 4, source("export const held = (cp, port) => cp.execSync(`lsof -i :${port}`);")),
      refused("pgrep", 4, source(`export const maybe = (look) => look?.("pgrep", ["node"]);`)),
      refused("pkill", 5, source(`// posix-only: runs only on the Mint box`, `export const box = () => run("pkill", ["-f", "watch.mjs"]);`)),
      refused("pgrep", 6, source(`export async function look(name) {`, `  if (name === "") return [];`, `  return run("pgrep", [name]);`, `}`)),
      refused("ps", 4, source(`export const ready = (on) => (on ? run("ps", ["-A"]) : null);`)),
      refused("ps", 4, source(`export const both = (on) => on && spawnSync("ps", ["-A"]);`)),
    ],
  });

  new RuleTester({ languageOptions: { parser: tseslint.parser } }).run("posix-commands", rule, {
    valid: [],
    invalid: [
      refused("ps", 2, `import { spawnSync } from "node:child_process";\nexport const all = (): Buffer => spawnSync("ps", ["-A"]).stdout;`, at("apps/desk/src/main.ts")),
    ],
  });
});

test("8.16 · storytree/posix-commands passes a command under a platform test (ternary, if, else if, logical, or an earlier if in its block reading platform, win32 or windows), git and psql, a command named only in a comment, a longer string or a later word of a shell string, and any call in a test file or outside packages/ and apps/", () => {
  const unbranched = source(`export const scan = () => run("ps", ["-A"]);`);
  const hitsAt = (file) => ruleHits(file, unbranched).map(({ line, rule: id }) => `${line} ${id}`);
  assert.deepEqual(hitsAt("packages/procs/src/scan.mjs"), ["4 storytree/posix-commands"]);
  assert.deepEqual(hitsAt("packages/procs/src/scan.test.mjs"), []);
  assert.deepEqual(hitsAt("scripts/scan.mjs"), []);

  new RuleTester().run("posix-commands", rule, {
    valid: [
      passes(source(`export const list = (platform) => (platform === "win32" ? run("tasklist", []) : run("ps", ["-A"]));`)),
      passes(source(
        `export function open(pid) {`,
        `  if (process.platform === "win32") {`,
        `    return run("tasklist", []);`,
        `  } else if (process.platform === "darwin") {`,
        `    execFileSync("ps", ["-p", String(pid)]);`,
        `  }`,
        `}`,
      )),
      passes(source(`export const some = () => process.platform !== "win32" && run("pgrep", ["node"]);`)),
      passes(source(`export async function pids() {`, `  if (process.platform === "win32") return [];`, `  return run("ps", ["-eo", "pid="]);`, `}`)),
      passes(source(
        `export async function holders(port, windows = process.platform === "win32") {`,
        `  if (windows) return run("netstat", ["-ano"]);`,
        `  const { stdout } = await run("lsof", ["-i", ":" + port]);`,
        `  return stdout;`,
        `}`,
      )),
      passes(source(`export const head = () => execFileSync("git", ["rev-parse", "HEAD"]);`)),
      passes(source(`export const status = () => execSync("git status");`)),
      passes(source(`export const query = () => run("psql", ["-c", "select 1"]);`)),
      passes(source(`export const shell = () => execSync("psql -c 1");`)),
      passes(source(`export const said = () => execSync("echo ps");`)),
      passes(source(`export const whole = () => execFileSync("ps -A");`)),
      passes(source(`export const note = "ps -A lists every process";`, `// run("ps", ["-A"]) on the box`)),
      passes(unbranched, at("packages/procs/src/scan.test.mjs")),
      passes(unbranched, at("scripts/scan.mjs")),
      passes(unbranched, at("docs/packages/scan.mjs")),
    ],
    invalid: [refused("ps", 4, unbranched, at("packages/procs/src/scan.mjs"))],
  });

  new RuleTester({ languageOptions: { parser: tseslint.parser } }).run("posix-commands", rule, {
    valid: [passes(`import { spawnSync } from "node:child_process";\nspawnSync("lsof", []);`, at("apps/desk/src/main.test.ts"))],
    invalid: [],
  });
});

test("8.16 · through pnpm lint's config, an unbranched lsof in a package's source is one storytree/posix-commands hit at its line naming lsof, escape_3d876fe9f3df, process.platform and the line disable, and // eslint-disable-next-line storytree/posix-commands -- <why> on the line before it leaves none", () => {
  const call = `export const holders = (port) => execFileSync("lsof", ["-i", ":" + port]);`;

  const hits = ruleHits("packages/procs/src/scan.mjs", source(call));
  assert.deepEqual(hits.map(({ line, rule: id }) => `${line} ${id}`), ["4 storytree/posix-commands"]);
  assert.match(hits[0].message, /\blsof\b/);
  assert.match(hits[0].message, /escape_3d876fe9f3df/);
  assert.match(hits[0].message, /process\.platform/);
  assert.match(hits[0].message, /\/\/ eslint-disable-next-line storytree\/posix-commands -- /);

  assert.deepEqual(ruleHits("packages/procs/src/scan.mjs", source(`// eslint-disable-next-line storytree/posix-commands -- only the Mint box runs it`, call)), []);
});

// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import * as oxlint from "../oxlint.mjs";
import plugin from "./index.mjs";

const rule = plugin.rules["anchored-process-match"];
const at = (file) => path.join(process.cwd(), file);
const SOURCE = at("packages/agent-pool/src/reclone.mjs");
const HEADER = [
  `import { execFile, spawn } from "node:child_process";`,
  `import { readFileSync } from "node:fs";`,
  `import { readFile } from "node:fs/promises";`,
  `import { join } from "node:path";`,
].join("\n");
const code = (line) => line.replaceAll("#{", "${").replaceAll("'", "`");
const source = (...lines) => [HEADER, ...lines.map(code)].join("\n");
const refused = (text, line = 5, filename = SOURCE) => ({ code: text, filename, errors: [{ messageId: "unanchored", line }] });
const passes = (text, filename = SOURCE) => ({ code: text, filename });
const ESCAPE = String.raw`export const loopRunning = (rows) => rows.some((row) => /launch-pool\.sh run\b/.test(row.args));`;

test("8.27 · storytree/anchored-process-match refuses, in a non-test source file under packages/ or apps/, a regex literal not anchored at the start with ^ whose .test or .exec subject is a process command line (a ps row's .args, or a read of /proc/<pid>/cmdline), and an execFile or spawn of pgrep or pkill whose -f pattern does not start with ^; its message names escape_24ab852d292f and to anchor to the executable from the start of the line; an anchored regex, a subject that is no command line, pgrep without -f, and a test file pass", () => {
  const message = rule?.meta?.messages?.unanchored ?? "";
  assert.match(message, /escape_24ab852d292f/);
  assert.match(message, /\^/, "names the ^ anchor");
  assert.match(message, /\bstart\b/, "says to anchor from the start of the line");
  assert.match(message, /\bexecutable\b/, "says to anchor to the executable");

  new RuleTester({ cwd: process.cwd() }).run("anchored-process-match", rule, {
    valid: [
      passes(source(String.raw`export const loopRunning = (rows) => rows.some((row) => /^(?:\S*\/)?(?:ba)?sh\s+(?:\S*\/)?launch-pool\.sh\s+run\b/.test(row.args));`)),
      passes(source(String.raw`export const isLoop = (proc, pid) => /^(?:\S*\/)?(?:ba)?sh\s+(?:\S*\/)?launch-pool\.sh\s+run\b/.test(readFileSync(join(proc, pid, "cmdline"), "utf8").split("\0").join(" "));`)),
      passes(source(String.raw`export const said = (line) => /foo/.test(line);`)),
      passes(source(String.raw`export const named = (hook) => /x/.test(hook.name);`)),
      passes(source(String.raw`export const found = (row) => /watch\.mjs/.exec(row.name);`)),
      passes(source(String.raw`export const shipIt = () => execFile("pgrep", ["-x", "ShipIt"]);`)),
      passes(source(String.raw`export const app = () => execFile("pgrep", ["-f", "^/opt/app( |$)"]);`)),
      passes(source(String.raw`export const own = (exe) => spawn("pkill", ["-TERM", "-f", '^#{exe}( |$)']);`)),
      passes(source(String.raw`export const plain = () => spawn("pkill", ["storytree"]);`)),
      passes(source(ESCAPE), at("packages/x/src/a.test.mjs")),
      passes(source(ESCAPE), at("scripts/x.mjs")),
      passes(source(ESCAPE), at("docs/packages/x.mjs")),
    ],
    invalid: [
      refused(source(ESCAPE)),
      refused(source(String.raw`export const isLoop = (proc, pid) => /launch-pool\.sh run\b/.test(readFileSync(join(proc, pid, "cmdline"), "utf8").split("\0").join(" "));`)),
      refused(source(String.raw`export const named = async (pid) => /storytree/.test((await readFile('/proc/#{pid}/cmdline', "utf8")).split("\0").join(" "));`)),
      refused(source(String.raw`export const match = (row) => /watch\.mjs/.exec(row.args);`)),
      refused(source(`export const running = () => execFile("pgrep", ["-f", "storytree"]);`)),
      refused(source(`export const stop = (pattern) => spawn("pkill", ["-TERM", "-f", pattern]);`)),
      refused(source(String.raw`export const quit = () => spawn("pkill", ["-TERM", "-f", "\\.local/share/storytree-0\\.3/storytree-0\\.3"]);`)),
      refused(source(`export const scan = (rows) => {`, String.raw`  const loops = rows.filter((row) => /launch-pool\.sh/.test(row.args));`, `  return loops;`, `};`), 6),
      refused(source(String.raw`export const anyLoop = (rows) => rows.find((row) => /launch-pool\.sh run\b/.test(row.args));`), 5, at("apps/desktop/src/pool.mjs")),
    ],
  });

  new RuleTester({ cwd: process.cwd(), languageOptions: { parserOptions: { lang: "ts" } } }).run("anchored-process-match", rule, {
    valid: [passes(String.raw`export const loopRunning = (rows: { args: string }[]) => rows.some((row) => /^bash \S*launch-pool\.sh run\b/.test(row.args));`, at("apps/desktop/src/pool.ts"))],
    invalid: [refused(String.raw`export const loopRunning = (rows: { args: string }[]) => rows.some((row) => /launch-pool\.sh run\b/.test(row.args));`, 1, at("apps/desktop/src/pool.ts"))],
  });
});

test("8.27 · through pnpm lint's config, the escape's own ps-row match in a package's source is one storytree/anchored-process-match hit at its line naming escape_24ab852d292f, and the same text in a test file or outside packages/ and apps/ is none", () => {
  const named = oxlint.ruleHits(["packages/agent-pool/src/queue.mjs", "packages/agent-pool/src/queue.test.mjs", "scripts/queue.mjs"].map((file) => ({ file, text: source(ESCAPE) })))
    .map((hits) => hits.filter(({ rule: id }) => id === "storytree/anchored-process-match"));
  const [hits, inTest, outside] = named;
  assert.deepEqual(hits.map(({ line }) => line), [5]);
  assert.match(hits[0].message, /escape_24ab852d292f/);
  assert.deepEqual(inTest, []);
  assert.deepEqual(outside, []);
});

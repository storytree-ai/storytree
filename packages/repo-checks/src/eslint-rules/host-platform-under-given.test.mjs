// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import * as oxlint from "../oxlint.mjs";
import plugin from "./index.mjs";

const rule = plugin.rules["host-platform-under-given"];
const ESCAPE = "escape_23c591a68875";
const SOURCE = "packages/a/src/run.mjs";
const TEST = "packages/a/src/run.test.mjs";
const naming = (given) => new RegExp(String.raw`^(?=[\s\S]*\b${given}\b)(?=[\s\S]*${ESCAPE})`);
const refused = (lines, ...errors) => ({ code: lines.join("\n"), filename: SOURCE, errors: errors.map(([line, given]) => ({ line, message: naming(given) })) });
const passes = (lines, filename = SOURCE) => ({ code: lines.join("\n"), filename });

const GIVEN_PARAMETER = [
  `export function isWindows(platform) {`,
  `  return process.platform === "win32";`,
  `}`,
];
const SHARE = [
  `function share(a, b) {`,
  `  if (process.platform === "darwin") return 1;`,
  `  return 2;`,
  `}`,
];
const RUN_UNIT = [
  `export function runUnit({ platform = process.platform }) {`,
  `  const settle = () => share(1, 2);`,
  `  return settle;`,
  `}`,
];

test("8.35 · storytree/host-platform-under-given refuses, in a non-test source file, a process.platform read inside a function binding a platform (a parameter, a destructured option, a local named platform, a closure inside one, a typed TypeScript parameter) or inside a same-file top-level helper it calls by name that binds none, but not that binding's own default; each message names the function given the platform and escape_23c591a68875; the default, a helper binding its own platform, a helper called from a function binding none, a function binding none and a test file pass", () => {
  assert.match(rule?.meta?.messages?.hostPlatform ?? "", new RegExp(ESCAPE));

  new RuleTester().run("host-platform-under-given", rule, {
    valid: [
      passes([`export function host() {`, `  return process.platform === "win32";`, `}`]),
      passes([`export function host(platform = process.platform) {`, `  return platform;`, `}`]),
      passes([`export function pick(x) {`, `  const platform = x.platform ?? process.platform;`, `  return platform === "linux";`, `}`]),
      passes([
        `function host(platform = process.platform) {`,
        `  return platform === "win32";`,
        `}`,
        `export function run({ platform = process.platform }) {`,
        `  return host(platform);`,
        `}`,
      ]),
      passes([...SHARE, `export function run(a) {`, `  return share(a, 2);`, `}`]),
      passes(GIVEN_PARAMETER, TEST),
      passes([...SHARE, ...RUN_UNIT], TEST),
    ],
    invalid: [
      refused(GIVEN_PARAMETER, [2, "isWindows"]),
      refused([`export const pick = ({ platform = process.platform }) => {`, `  if (process.platform === "darwin") return 1;`, `  return platform;`, `};`], [2, "pick"]),
      refused([`export function pick(options) {`, `  const platform = options.platform ?? process.platform;`, `  return process.platform === "win32" || platform === "linux";`, `}`], [3, "pick"]),
      refused([...SHARE, ...RUN_UNIT], [2, "runUnit"]),
      refused([...RUN_UNIT, ...SHARE], [6, "runUnit"]),
      refused([`export function watch(platform) {`, `  return () => process.platform === "linux";`, `}`], [2, "watch"]),
    ],
  });

  new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } }).run("host-platform-under-given", rule, {
    valid: [passes([`export function exitCode(code: number, platform: NodeJS.Platform = process.platform): number {`, `  return platform === "win32" ? code : 0;`, `}`], "packages/a/src/run.ts")],
    invalid: [
      {
        ...refused([`export function exitCode(code: number, platform: NodeJS.Platform = process.platform): number {`, `  return process.platform === "win32" ? code : 0;`, `}`], [2, "exitCode"]),
        filename: "packages/a/src/run.ts",
      },
    ],
  });
});

test("8.35 · through pnpm lint's config, the escape's own cpuShare in packages/base-dev-loop/src/unit-run.mjs at PR #1060's merge f43ea20f is one storytree/host-platform-under-given hit naming runUnit and escape_23c591a68875", () => {
  const file = "packages/base-dev-loop/src/unit-run.mjs";
  const text = readFileSync(new URL("./fixtures/unit-run-f43ea20f.txt", import.meta.url), "utf8");
  assert.match(text.split("\n")[324], /^\s*if \(process\.platform === "darwin"\)/, "line 325 is cpuShare's read");
  const [hits] = oxlint.ruleHits([{ file, text }]).map((found) => found.filter(({ rule: id }) => id === "storytree/host-platform-under-given"));
  const atShare = hits.filter(({ line }) => line === 325);
  assert.equal(atShare.length, 1, `one hit at cpuShare's read, got lines ${JSON.stringify(hits.map(({ line }) => line))}`);
  assert.match(atShare[0].message, /\brunUnit\b/);
  assert.match(atShare[0].message, new RegExp(ESCAPE));
});

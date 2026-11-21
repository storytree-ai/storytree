// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import * as oxlint from "../oxlint.mjs";
import plugin from "./index.mjs";

const rule = plugin.rules["write-names-place"];
const code = (line) => line.replaceAll("#", "$").replaceAll("'", "`");
const refused = (line, count = 1) => ({ code: code(line), errors: Array.from({ length: count }, () => ({ messageId: "unplaced" })) });

test("8.25 · storytree/write-names-place refuses an argv array literal spelling a composed base write (fyi new through a storytree(...) wrapper with a spread of fields, -s storytree fyi new through run(\"pnpm\", ...), bare arc new, question new whose arc input is optional, fyi heard whose required input is no place, a template-built flag, two in one file each) holding no \"--project\", \"--arc\" or \"--increment\" literal, its message naming the command, escape_d6cd4011df60 and ADR-1348 D3; the same with any of the three flags, a read (library read, arc waits), a write whose required arc input is the place (arc edit, arc wait), a write asking only for its usage (\"--help\"), an array not starting with a command and a string holding the words pass", () => {
  assert.match(rule?.meta?.messages?.unplaced ?? "", /escape_d6cd4011df60/);
  assert.match(rule.meta.messages.unplaced, /ADR-1348 D3/);

  new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } }).run("write-names-place", rule, {
    valid: [
      String.raw`export const told = (storytree: (args: string[]) => string, fyi: Record<string, string>, x: string) => storytree(["fyi", "new", "--by", "watcher", "--project", x, ...Object.entries(fyi).flatMap(([f, t]) => ['--#{f}', t])]);`,
      String.raw`export const told = (run: (cmd: string, args: string[]) => string, t: string, a: string) => run("pnpm", ["-s", "storytree", "fyi", "new", "--title", t, "--arc", a]);`,
      String.raw`export const told = (t: string, i: string) => ["storytree", "fyi", "new", "--title", t, "--increment", i];`,
      String.raw`export const parked = (t: string, x: string) => ["arc", "new", "--title", t, "--project", x];`,
      String.raw`export const asked = (t: string, a: string) => ["question", "new", "--title", t, "--arc", a];`,
      String.raw`export const heard = (id: string, x: string) => ["fyi", "heard", id, "--project", x];`,
      String.raw`export const read = (id: string) => ["library", "read", id];`,
      String.raw`export const waits = () => ["-s", "storytree", "arc", "waits"];`,
      String.raw`export const edited = (arc: string, t: string) => ["arc", "edit", arc, "--title", t];`,
      String.raw`export const waited = (arc: string, on: string) => ["storytree", "arc", "wait", arc, "--on", on];`,
      String.raw`export const usage = () => ["question", "new", "--help"];`,
      String.raw`export const usage = (t: string) => ["-s", "storytree", "arc", "new", "--title", t, "--help"];`,
      String.raw`export const family = () => ["fyi"];`,
      String.raw`export const reversed = () => ["new", "fyi"];`,
      String.raw`export const words = () => "storytree fyi new --title t";`,
      String.raw`export const said = () => ["the", "storytree", "fyi", "new"];`,
    ].map(code),
    invalid: [
      refused(String.raw`export const told = (storytree: (args: string[]) => string, fyi: Record<string, string>) => storytree(["fyi", "new", "--by", "watcher", ...Object.entries(fyi).flatMap(([f, t]) => ['--#{f}', t])]);`),
      refused(String.raw`export const told = (run: (cmd: string, args: string[]) => string, t: string) => run("pnpm", ["-s", "storytree", "fyi", "new", "--title", t]);`),
      refused(String.raw`export const parked = (t: string) => ["arc", "new", "--title", t];`),
      refused(String.raw`export const asked = (t: string) => ["question", "new", "--title", t];`),
      refused(String.raw`export const heard = (id: string) => ["storytree", "fyi", "heard", id];`),
      refused(String.raw`export const built = (place: string, x: string) => ["fyi", "new", '--#{place}', x];`),
      refused(String.raw`export const both = (t: string) => [["arc", "new", "--title", t], ["question", "new", "--title", t]];`, 2),
    ],
  });

  new RuleTester().run("write-names-place", rule, {
    valid: [`export const parked = (t, x) => ["arc", "new", "--title", t, "--project", x];`],
    invalid: [refused(`export const parked = (t) => ["arc", "new", "--title", t];`)],
  });

  const lint = (source) => oxlint.ruleHits([{ file: "packages/b/src/b.mjs", text: source }])[0].filter(({ rule: id }) => id === "storytree/write-names-place");
  const told = lint(code(String.raw`export const told = (t) => ["-s", "storytree", "fyi", "new", "--title", t];`));
  assert.deepEqual(told.map(({ line, rule: id }) => [line, id]), [[1, "storytree/write-names-place"]]);
  assert.match(told[0].message, /fyi new/);
  assert.match(told[0].message, /escape_d6cd4011df60/);
  assert.match(told[0].message, /ADR-1348 D3/);
  const parked = lint(`export const parked = (t) => ["arc", "new", "--title", t];`);
  assert.match(parked[0]?.message ?? "", /arc new/);
  assert.doesNotMatch(parked[0].message, /fyi new/);
});

test("8.25 · storytree/write-names-place reads past pnpm's own options before storytree: it refuses fyi new after \"--dir\" with a non-literal value and \"-s\" holding a spread of fields, arc new after \"-C\" with a non-literal value and \"--silent\", and arc new after \"exec\", each naming no place, the message naming fyi new and arc new for the first two; the same fyi new with \"--project\" and a library read after \"--dir\" and \"-s\" pass", () => {
  new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } }).run("write-names-place", rule, {
    valid: [
      String.raw`export const told = (run: (cmd: string, args: string[]) => string, repo: string, fields: string[], x: string) => run("pnpm", ["--dir", repo, "-s", "storytree", "fyi", "new", "--by", "watcher", "--project", x, ...fields]);`,
      String.raw`export const read = (run: (cmd: string, args: string[]) => string, repo: string, id: string) => run("pnpm", ["--dir", repo, "-s", "storytree", "library", "read", id]);`,
    ].map(code),
    invalid: [
      refused(String.raw`export const told = (run: (cmd: string, args: string[]) => string, repo: string, fields: string[]) => run("pnpm", ["--dir", repo, "-s", "storytree", "fyi", "new", "--by", "watcher", ...fields]);`),
      refused(String.raw`export const parked = (run: (cmd: string, args: string[]) => string, repo: string, t: string) => run("pnpm", ["-C", repo, "--silent", "storytree", "arc", "new", "--title", t]);`),
      refused(String.raw`export const parked = (run: (cmd: string, args: string[]) => string, t: string) => run("pnpm", ["exec", "storytree", "arc", "new", "--title", t]);`),
    ],
  });

  const lint = (source) => oxlint.ruleHits([{ file: "packages/b/src/b.mjs", text: source }])[0].filter(({ rule: id }) => id === "storytree/write-names-place");
  const planted = lint(`export const told = (run, repo, fields) => run("pnpm", ["--dir", repo, "-s", "storytree", "fyi", "new", "--by", "watcher", ...fields]);`);
  assert.deepEqual(planted.map(({ line, rule: id }) => [line, id]), [[1, "storytree/write-names-place"]]);
  assert.match(planted[0].message, /"storytree fyi new"/);
  const silent = lint(`export const parked = (run, repo, t) => run("pnpm", ["-C", repo, "--silent", "storytree", "arc", "new", "--title", t]);`);
  assert.deepEqual(silent.map(({ rule: id }) => id), ["storytree/write-names-place"]);
  assert.match(silent[0].message, /"storytree arc new"/);
});

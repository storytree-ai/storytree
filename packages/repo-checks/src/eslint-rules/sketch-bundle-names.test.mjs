// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import * as oxlint from "../oxlint.mjs";
import plugin from "./index.mjs";

const rule = plugin.rules["sketch-bundle-names"];
const at = (file) => path.join(process.cwd(), file);
const SKETCH = "docs/design/tree/a-sketch";
const LONG = `!function(){${"var a=1;".repeat(200)}}();\n`;
const DATA = `window.CAPTREE = ${JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ id: `item_${i}`, title: "An item" })) })};\n`;
const MIXED = DATA.replace(/;\n$/, "; document.title = 'x';\n");
const CODE = DATA.replace(/\}\]\};\n$/, ', "run": (function(){ document.title = "x"; })()}]};\n');
const lineOf = (length) => `var s="${"x".repeat(length - 9)}";\n`;
const LATE = `const a = 1;\nconsole.log(a);\n${LONG}`;
const DECLARED = DATA.replace(/^window\.CAPTREE =/, "const CAPTREE =");

const refused = (file, code) => ({ code, filename: at(`${SKETCH}/${file}`), errors: 1 });
const passes = (file, code) => ({ code, filename: at(file.includes("/") ? file : `${SKETCH}/${file}`) });

test("8.10 · storytree/sketch-bundle-names refuses a .js under docs/design with a line over 1,000 characters, wherever the line falls, named other than *.min.js or *-min.js (a name merely ending in min.js, like admin.js, is not), unless the whole file is one window.NAME = {…}; whose value parses as JSON: data followed by code, data whose value is not JSON, and data assigned to anything but window are refused, once per file", () => {
  assert.equal(lineOf(1001).length, 1002);
  new RuleTester({ cwd: process.cwd() }).run("sketch-bundle-names", rule, {
    valid: [],
    invalid: [
      refused("page.js", LONG),
      refused("admin.js", LONG),
      refused("three.js", LONG),
      refused("vendor.js", lineOf(1001)),
      refused("late.js", LATE),
      refused("mixed.js", MIXED),
      refused("code.js", CODE),
      refused("declared.js", DECLARED),
    ],
  });
});

test("8.10 · storytree/sketch-bundle-names passes a *.min.js or *-min.js bundle, a hand-written .js whose lines are all 1,000 characters or fewer, one window.NAME = {…}; data assignment whose value is JSON, a long .js outside docs/design, and a long .mjs under docs/design", () => {
  assert.equal(lineOf(1000).length, 1001);
  new RuleTester({ cwd: process.cwd() }).run("sketch-bundle-names", rule, {
    valid: [
      passes("page.min.js", LONG),
      passes("worker-min.js", LONG),
      passes("hand.js", "const x = 1;\nconsole.log(x);\n"),
      passes("edge.js", lineOf(1000)),
      passes("data.js", DATA),
      passes("packages/x/src/long.js", LONG),
      passes("docs/packages/long.js", LONG),
      passes("docs/design-notes/long.js", LONG),
      passes(`${SKETCH}/page.mjs`, LONG),
    ],
    invalid: [refused("page.js", LONG)],
  });
});

test("8.10 · through pnpm lint's config, a long page.js under docs/design is one storytree/sketch-bundle-names hit whose message names page.min.js, the build.mjs that writes it, its page's script tag and keeping it to one data assignment; worker.js's names worker.min.js; page.min.js and a JSON data.js leave none", () => {
  const [hits, worker, minified, data] = oxlint.ruleHits([
    { file: `${SKETCH}/page.js`, text: LONG },
    { file: `${SKETCH}/worker.js`, text: LONG },
    { file: `${SKETCH}/page.min.js`, text: LONG },
    { file: `${SKETCH}/data.js`, text: DATA },
  ]);
  assert.deepEqual(hits.map(({ rule: id }) => id), ["storytree/sketch-bundle-names"]);
  assert.match(hits[0].message, /\bpage\.min\.js\b/);
  assert.match(hits[0].message, /\bbuild\.mjs\b/);
  assert.match(hits[0].message, /script tag/);
  assert.match(hits[0].message, /one data assignment/);

  assert.equal(worker.length, 1);
  assert.match(worker[0].message, /\bworker\.min\.js\b/);
  assert.doesNotMatch(worker[0].message, /\bpage\.min\.js\b/);

  assert.deepEqual(minified, []);
  assert.deepEqual(data, []);
});

test("8.10 · the rule module exports MINIFIED_NAME, the minified-bundle name test the push check also reads: it matches page.min.js and worker-min.js, and neither page.js nor admin.js", async () => {
  const { MINIFIED_NAME } = await import("./sketch-bundle-names.mjs");
  assert.ok(MINIFIED_NAME instanceof RegExp);
  assert.deepEqual(["page.min.js", "worker-min.js", "page.js", "admin.js", "docs/design/a/three.min.js"].map((name) => MINIFIED_NAME.test(name)), [true, true, false, false, true]);
});

// Capability 8 · Storytree's own test and gate entries. increment_25ec3aa5f204 (question_878200d16277, option 3): a
// minified bundle committed under docs/design is named *.min.js, which CodeQL's JavaScript extractor skips, so `pnpm lint`
// refuses one named otherwise; a file that is only one data assignment passes, and no file is exempt by name.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { RULES, lint } from "./lint.mjs";

const LONG = `!function(){${"var a=1;".repeat(200)}}();\n`;
const DATA = `window.CAPTREE = ${JSON.stringify({ items: Array.from({ length: 100 }, (_, i) => ({ id: `item_${i}`, title: "An item" })) })};\n`;

test("8.10 pnpm lint refuses a .js under docs/design with a line over 1,000 characters unless it is named *.min.js or is one data assignment, naming the file and the fix; a short hand-written file passes", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "sketch-bundles-"));
  t.after(() => removeTemp(root));
  const sketch = path.join(root, "docs", "design", "tree", "a-sketch");
  mkdirSync(sketch, { recursive: true });
  writeFileSync(path.join(sketch, "page.js"), LONG);
  writeFileSync(path.join(sketch, "page.min.js"), LONG);
  writeFileSync(path.join(sketch, "worker-min.js"), LONG);
  writeFileSync(path.join(sketch, "hand.js"), "const x = 1;\nconsole.log(x);\n");
  writeFileSync(path.join(sketch, "data.js"), DATA);
  writeFileSync(path.join(sketch, "mixed.js"), DATA.replace(/;\n$/, "; document.title = 'x';\n"));
  writeFileSync(path.join(sketch, "code.js"), DATA.replace(/\}\]\};\n$/, ', "run": (function(){ document.title = "x"; })()}]};\n'));
  for (const skipped of ["node_modules", ".cache"]) {
    mkdirSync(path.join(sketch, skipped), { recursive: true });
    writeFileSync(path.join(sketch, skipped, "lib.js"), LONG);
  }
  mkdirSync(path.join(root, "packages", "x", "src"), { recursive: true });
  writeFileSync(path.join(root, "packages", "x", "src", "long.js"), LONG);

  const rule = RULES.find(({ name }) => name === "sketch-bundle-names");
  assert.ok(rule, RULES.map(({ name }) => name).join(", "));
  const lines = [];
  assert.equal(await lint({ root, rules: [rule], log: (line) => lines.push(line) }), 1);
  const refused = lines.filter((line) => line.startsWith("sketch-bundle-names: "));
  assert.deepEqual(refused.map((line) => line.split(" ")[1]).sort(), ["docs/design/tree/a-sketch/code.js", "docs/design/tree/a-sketch/mixed.js", "docs/design/tree/a-sketch/page.js"], lines.join("\n"));
  const page = refused.find((line) => line.includes("/page.js "));
  assert.match(page, /page\.min\.js/);
  assert.match(page, /build\.mjs/);
  assert.match(page, /script tag/);
});

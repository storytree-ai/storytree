// Capability 8 · Storytree's own test and gate entries. increment_823822137caa / friction_edc7a93a10fe: a failing
// assert.equal whose operand is a happy-dom node makes Node describe it without bound, so `pnpm lint` refuses one.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { happyDomAssertProblems } from "./happy-dom-asserts.mjs";

const PAGE = `import assert from "node:assert/strict";
import { test } from "node:test";
import { Window, type HTMLButtonElement } from "happy-dom";

test("1.1 a page", () => {
  const { document } = new Window();
  const on = { content: document.body, body: document.body, count: 3 };
  const rail = () => on.content.querySelector(".rail")!;
  const tabs = () => [...rail().querySelectorAll("[role=tab]")];
  const button = document.getElementById("go");
  const press = (target: HTMLButtonElement) => assert.strictEqual(target, button);
  assert.equal(document.querySelector("#read-error"), null);
  assert.equal(on.content.firstElementChild, rail(), "the rail leads");
  assert.deepEqual([button], []);
  assert.deepEqual(tabs(), []);
  assert.equal(document.querySelector("#read-error")?.textContent, "The forest could not be read");
  assert.equal(on.count, 3);
  assert.equal(on.body.dataset.state, "ready");
  assert.deepEqual(tabs().map((tab) => tab.textContent), ["Sessions", "Arcs"]);
  assert.ok(rail() === null, "no rail");
  assert.equal(button?.hidden, true);
  press(button as HTMLButtonElement);
});
`;

const BAD_LINES = [11, 12, 13, 14, 15];

test("8.6 pnpm lint refuses an assert.equal-family call on what may be a happy-dom node in a test file importing happy-dom, naming file, line and assert.ok(a === b, message); primitive comparisons there, and files without happy-dom, pass", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "happy-dom-asserts-"));
  t.after(() => removeTemp(root));
  const plant = (file, text) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  plant("packages/view/src/page.test.ts", PAGE);
  plant("packages/view/src/plain.test.ts", 'import assert from "node:assert/strict";\nassert.equal(document.querySelector("a"), null);\n');
  plant("packages/view/src/page.ts", PAGE);
  plant("packages/view/node_modules/dep/page.test.ts", PAGE);

  const problems = happyDomAssertProblems(root);

  assert.deepEqual(problems.map((problem) => /^packages\/view\/src\/page\.test\.ts:(\d+) /.exec(problem)?.[1]).map(Number), BAD_LINES, problems.join("\n"));
  for (const problem of problems) assert.match(problem, /assert\.ok\(a === b, message\)/);
});

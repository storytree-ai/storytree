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

/** Named imports, aliases, loop variables, callback and default parameters, reassignment, branches and nested destructuring. */
const SHAPES = `import { equal, deepEqual as same } from "node:assert";
import { test } from "node:test";
import { Window } from "happy-dom";
import type { Item } from "./item";

interface Node { id: string }

export const page = new Window().document;

test("1.2 shapes", async () => {
  let found;
  found = page.querySelector("a");
  equal(found, null);
  for (const link of page.querySelectorAll("a")) equal(link, null);
  [...page.querySelectorAll("li")].forEach((item) => same(item, {}));
  const pick = (chosen = page.body) => equal(chosen, null);
  equal(Math.random() > 0.5 ? page.body : null, null);
  equal(null ?? page.body, null);
  equal(await (page.body as unknown), null);
  const { head: { firstChild: top }, ...rest } = page;
  equal(top, null);
  const { title } = page;
  equal(title, "");
  let count = 0;
  count = page.querySelectorAll("a").length;
  equal(count, 0);
  for (const word of ["a", "b"]) equal(word, "a");
  ["a"].forEach((word) => equal(word, "a"));
  const own = (node: Node, item: Item) => { equal(node, null); equal(item, null); };
  equal(Math.random() > 0.5 ? "a" : "b", "a");
  pick();
  own({ id: "x" }, {} as Item);
});
`;

const SHAPE_LINES = [13, 14, 15, 16, 17, 18, 19, 21];

const OTHER_ASSERTS = `import { strictEqual } from "assert";
import { equal } from "./mine";
import { Window } from "happy-dom";
const { document } = new Window();
strictEqual(document.body, null);
equal(document.body, null);
`;

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
  plant("packages/view/src/shapes.test.ts", SHAPES);
  plant("packages/view/src/other.test.mjs", OTHER_ASSERTS);

  const problems = happyDomAssertProblems(root);

  const linesIn = (file) => problems.flatMap((problem) => (problem.startsWith(`${file}:`) ? [Number(problem.slice(file.length + 1).split(" ")[0])] : []));
  assert.equal(problems.filter((problem) => !/^packages\/view\/src\/(?:page|shapes)\.test\.ts:|^packages\/view\/src\/other\.test\.mjs:/.test(problem)).length, 0, problems.join("\n"));
  assert.deepEqual(linesIn("packages/view/src/page.test.ts"), BAD_LINES, problems.join("\n"));
  assert.deepEqual(linesIn("packages/view/src/shapes.test.ts"), SHAPE_LINES, problems.join("\n"));
  assert.deepEqual(linesIn("packages/view/src/other.test.mjs"), [5], "only node's own assert counts");
  for (const problem of problems) assert.match(problem, /assert\.ok\(a === b, message\)/);
});

/** Helpers a local factory returns, destructured or read as members: the panel-folds form (increment_6b3c738489a6). */
const FACTORY = `import assert from "node:assert/strict";
import { test } from "node:test";
import { Window } from "happy-dom";

function page() {
  const window = new Window();
  const handle = (kind: string): HTMLButtonElement => window.document.querySelector(kind)!;
  const focused = (): Element | null => window.document.activeElement as unknown as Element | null;
  const label = (kind: string): string => handle(kind).textContent ?? "";
  return { window, handle, focused, label, nested: { focused }, first() { return window.document.body.firstElementChild; } };
}

test("1.3 a factory", () => {
  const { handle, focused, label, nested: { focused: deep } } = page();
  const p = page();
  assert.equal(focused(), handle("more"), "down moves on");
  assert.equal(p.focused(), null);
  assert.equal(deep(), null);
  assert.equal(p.first(), null);
  assert.equal(label("more"), "More");
  assert.equal(focused()?.textContent, "Open all");
  assert.ok(focused() === handle("more"), "identity passes");
});
`;

test("8.6 pnpm lint refuses an assert.equal-family call on the result of a node-returning helper destructured from, or read as a member of, the object a local function returns; the helpers' strings pass", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "happy-dom-asserts-"));
  t.after(() => removeTemp(root));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src/factory.test.ts"), FACTORY);

  const problems = happyDomAssertProblems(root);

  assert.deepEqual(problems.map((problem) => Number(problem.split(" ")[0].split(":")[1])), [16, 17, 18, 19], problems.join("\n"));
});

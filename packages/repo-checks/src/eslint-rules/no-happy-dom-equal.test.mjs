// Capability 8 · Storytree's own test and gate entries.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import plugin from "./index.mjs";

const rule = plugin.rules["no-happy-dom-equal"];
const refused = (code, filename, reports) => ({ code, filename, errors: reports.map(([line, callee, shown]) => ({ messageId: "nodeEqual", line, data: { callee, shown } })) });

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

const OTHER_ASSERTS = `import { strictEqual } from "assert";
import { equal } from "./mine";
import { Window } from "happy-dom";
const { document } = new Window();
strictEqual(document.body, null);
equal(document.body, null);
`;

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

const EDGES = `import assert from "node:assert/strict";
import { Window } from "happy-dom";
const { document } = new Window();
function node() {
  return document.body;
}
function name() {
  return "x";
}
assert.equal(name(), "x");
assert.equal(node(), null);
assert.equal(document.querySelector("#xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), null);
assert.equal(document.querySelector("#xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), null);
assert.deepEqual([
  document.body,
], []);
`;

const PLAIN = 'import assert from "node:assert/strict";\nassert.equal(document.querySelector("a"), null);\n';

test("8.6 · storytree/no-happy-dom-equal refuses, in a test file importing happy-dom, an assert.equal-family call whose operand may be a happy-dom node (a DOM query, a node-only property, a new Window, a name, destructured name, loop variable, callback or default parameter bound to one, a branch holding one, or a node-returning helper destructured from, or read as a member of, the object a local function returns; node's own assert only), its message naming assert.ok(a === b, message), the call and the operand (whitespace collapsed, cut to 57 characters and ... past 60); primitive comparisons there, an identity assert.ok, a block-bodied local function returning a string, a file importing no happy-dom and a file that is not a test pass", () => {
  assert.match(rule?.meta?.messages?.nodeEqual ?? "", /assert\.ok\(a === b, message\)/);

  new RuleTester({ languageOptions: { parser: tseslint.parser } }).run("no-happy-dom-equal", rule, {
    valid: [
      { code: PLAIN, filename: "packages/view/src/plain.test.ts" },
      { code: PAGE, filename: "packages/view/src/page.ts" },
      { code: FACTORY, filename: "packages/view/src/factory.ts" },
    ],
    invalid: [
      refused(PAGE, "packages/view/src/page.test.ts", [
        [11, "assert.strictEqual", "target"],
        [12, "assert.equal", 'document.querySelector("#read-error")'],
        [13, "assert.equal", "on.content.firstElementChild"],
        [14, "assert.deepEqual", "[button]"],
        [15, "assert.deepEqual", "tabs()"],
      ]),
      refused(SHAPES, "packages/view/src/shapes.test.ts", [
        [13, "equal", "found"],
        [14, "equal", "link"],
        [15, "same", "item"],
        [16, "equal", "chosen"],
        [17, "equal", "Math.random() > 0.5 ? page.body : null"],
        [18, "equal", "null ?? page.body"],
        [19, "equal", "await (page.body as unknown)"],
        [21, "equal", "top"],
      ]),
      refused(OTHER_ASSERTS, "packages/view/src/other.test.mjs", [[5, "strictEqual", "document.body"]]),
      refused(FACTORY, "packages/view/src/factory.test.ts", [
        [16, "assert.equal", "focused()"],
        [17, "assert.equal", "p.focused()"],
        [18, "assert.equal", "deep()"],
        [19, "assert.equal", "p.first()"],
      ]),
      refused(EDGES, "packages/view/src/edges.test.ts", [
        [11, "assert.equal", "node()"],
        [12, "assert.equal", 'document.querySelector("#xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")'],
        [13, "assert.equal", 'document.querySelector("#xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...'],
        [14, "assert.deepEqual", "[ document.body, ]"],
      ]),
    ],
  });

  new RuleTester().run("no-happy-dom-equal", rule, {
    valid: [{ code: OTHER_ASSERTS, filename: "packages/view/src/other.mjs" }],
    invalid: [refused(OTHER_ASSERTS, "packages/view/src/other.test.mjs", [[5, "strictEqual", "document.body"]])],
  });
});

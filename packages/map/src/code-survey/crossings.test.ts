/**
 * Capability 3 · Counts before detail: what crosses a line drawn round files of a mapped island (ADR-0993 D6,
 * D10). Written against a small import and a small checkout in temporary folders.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { AnnotatedTree } from "@storytree/library";

import { crossingsOf, formatCrossing } from "./crossings.js";
import { codeSurveyReader } from "./read-survey.js";

const SHOP_REPOSITORY = "https://example.test/shop.git";
const DESK_REPOSITORY = "https://example.test/desk.git";

const mappedStory = (id: string, title: string, pkg: string, from = SHOP_REPOSITORY) =>
  ({ id, title, capabilities: [], mapped: { from, package: pkg, folders: [pkg] } });

const tree = { arcs: [], stories: [
  { id: "story-built", title: "Built", capabilities: [] },
  mappedStory("story-cart", "@shop/cart", "packages/cart"),
  mappedStory("story-pay", "@shop/pay", "packages/pay"),
  mappedStory("story-desk", "desk", "src", DESK_REPOSITORY),
] } as unknown as AnnotatedTree;

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
}

/** An imported shop whose cart has a ui folder, reached by a relative path, a path alias and a package name. */
const SHOP = {
  "package.json": JSON.stringify({ name: "shop", workspaces: ["packages/*"] }),
  "tsconfig.json": "{\n  // the cart's alias\n  \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@/*\": [\"packages/cart/src/*\"], }, },\n}\n",
  "packages/cart/package.json": JSON.stringify({ name: "@shop/cart", main: "src/index.ts" }),
  "packages/cart/src/ui/sidebar.tsx": "import { format } from \"../lib/format.js\";\n// import { gone } from \"../lib/gone.js\";\nimport { pay } from \"@shop/pay\";\nexport const Sidebar = () => format(pay());\n",
  "packages/cart/src/ui/menu.ts": "import { Sidebar } from \"./sidebar\";\nexport const Menu = Sidebar;\n",
  "packages/cart/src/lib/format.ts": "export const format = (value: unknown) => String(value);\n",
  "packages/cart/src/index.ts": "export { Sidebar } from \"./ui/sidebar.js\";\nexport const text = \"import x from './ui/menu'\";\n",
  "packages/cart/src/page.ts": "import { Menu } from \"@/ui/menu\";\nimport \"@/ui/sidebar\";\nexport const page = Menu;\n",
  "packages/pay/package.json": JSON.stringify({ name: "@shop/pay", exports: { ".": "./lib/pay.mjs" } }),
  "packages/pay/lib/pay.mjs": "const menu = require(\"@shop/cart/src/ui/menu\");\nexport const pay = () => menu;\n",
};

async function fixture() {
  const shop = await mkdtemp(path.join(tmpdir(), "crossing-shop-"));
  const desk = await mkdtemp(path.join(tmpdir(), "crossing-desk-"));
  const trunk = await mkdtemp(path.join(tmpdir(), "crossing-trunk-"));
  await write(shop, SHOP);
  await write(desk, { "package.json": JSON.stringify({ name: "desk" }), "src/ui/panel.ts": "export const panel = 1;\n" });
  const old = path.relative(path.join(trunk, "packages/built"), path.join(shop, "packages/cart/src")).split(path.sep).join("/");
  await write(trunk, {
    "packages/built/package.json": JSON.stringify({ name: "@x/built" }),
    "packages/built/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@old/*": [`${old}/*`] } } }),
    "packages/built/src/index.ts": "import { Menu } from \"@shop/cart/src/ui/menu\";\nimport \"@old/ui/sidebar.js\";\nexport const built = Menu;\n",
  });
  const imports = [{ folder: shop, repository: SHOP_REPOSITORY }, { folder: desk, repository: DESK_REPOSITORY }];
  const survey = await codeSurveyReader({ checkout: "current" }).read(trunk, tree, imports);
  return { shop, desk, trunk, survey, done: () => Promise.all([shop, desk, trunk].map((folder) => rm(folder, { recursive: true, force: true }))) };
}

test("3.9 for folders in a mapped island the map counts the files outside that import files inside, the island's and built stories' apart, and the files inside that import files outside, through relative paths, tsconfig paths and package names", async () => {
  const { shop, trunk, survey, done } = await fixture();
  try {
    const counted = await crossingsOf(tree, survey, trunk, { patterns: ["packages/cart/src/ui"] });
    assert.equal(counted.island, shop);
    assert.deepEqual(counted.stories, ["@shop/cart"]);
    assert.equal(counted.inside, 2, "the ui folder's two files");
    assert.deepEqual(counted.in, { island: { files: 3, imports: 4 }, built: { files: 1, imports: 2 } },
      "index re-exports, page by alias twice, pay by package subpath; the built package by name and by its own alias; a string and an import inside are none");
    assert.deepEqual(counted.out, { island: { files: 1, imports: 2 }, built: { files: 0, imports: 0 } }, "the sidebar imports format and pay; a commented import is none");
    assert.equal(counted.rows, undefined, "counts first: no list");
    assert.match(counted.note, /database or events/);

    const shown = await crossingsOf(tree, survey, trunk, { patterns: ["packages/*/src/ui/**"], mode: "show" });
    assert.equal(shown.inside, 2, "* stays within a segment and ** crosses them");
    assert.deepEqual(shown.rows, [
      { direction: "in", side: "built", from: "packages/built/src/index.ts", to: "packages/cart/src/ui/menu.ts" },
      { direction: "in", side: "built", from: "packages/built/src/index.ts", to: "packages/cart/src/ui/sidebar.tsx" },
      { direction: "in", side: "island", from: "packages/cart/src/index.ts", to: "packages/cart/src/ui/sidebar.tsx" },
      { direction: "in", side: "island", from: "packages/cart/src/page.ts", to: "packages/cart/src/ui/menu.ts" },
      { direction: "in", side: "island", from: "packages/cart/src/page.ts", to: "packages/cart/src/ui/sidebar.tsx" },
      { direction: "in", side: "island", from: "packages/pay/lib/pay.mjs", to: "packages/cart/src/ui/menu.ts" },
      { direction: "out", side: "island", from: "packages/cart/src/ui/sidebar.tsx", to: "packages/cart/src/lib/format.ts" },
      { direction: "out", side: "island", from: "packages/cart/src/ui/sidebar.tsx", to: "packages/pay/lib/pay.mjs" },
    ]);
    assert.match(formatCrossing(shown), /packages\/cart\/src\/page\.ts -> packages\/cart\/src\/ui\/menu\.ts/);

    const full = await crossingsOf(tree, survey, trunk, { patterns: [path.join(shop, "packages/cart/src/ui/menu.ts")] });
    assert.equal(full.inside, 1, "a full path is accepted");
    assert.deepEqual(full.in.island, { files: 2, imports: 2 });

    const refused = await crossingsOf(tree, survey, trunk, { patterns: ["packages/cart/src/ui"], mode: "show" }, { ceiling: 3 });
    assert.equal(refused.refused, true);
    assert.equal(refused.rows, undefined, "above the ceiling show refuses with the counts, never a cut list");
    assert.equal(refused.rowCount, 8);
  } finally {
    await done();
  }
});

test("3.9 a line is refused when its patterns match nothing or span two imports; naming a mapped story keeps it to that story's files", async () => {
  const { trunk, survey, done } = await fixture();
  try {
    await assert.rejects(crossingsOf(tree, survey, trunk, { patterns: ["nowhere"] }), /No mapped file matches/);
    await assert.rejects(crossingsOf(tree, survey, trunk, { patterns: ["**/ui"] }), /two imports/);
    const desk = await crossingsOf(tree, survey, trunk, { patterns: ["**/ui"], story: "desk" });
    assert.equal(desk.inside, 1);
    assert.deepEqual(desk.stories, ["desk"]);
    await assert.rejects(crossingsOf(tree, survey, trunk, { patterns: ["src"], story: "Built" }), /not a mapped story/);
  } finally {
    await done();
  }
});

test("3.9 a pattern's empty segments are dropped, so a long run of slashes inside it is read as one", async () => {
  const { trunk, survey, done } = await fixture();
  try {
    await assert.rejects(crossingsOf(tree, survey, trunk, { patterns: [`x${"/".repeat(40_000)}y`] }), /No mapped file matches/);
  } finally {
    await done();
  }
});

test("3.10 an explored capability named cap:<id|number> in place of folders draws the line round the files it covers, among its story's files; a capability covering nothing is refused", async () => {
  const capabilities: Record<string, unknown[]> = {
    "story-cart": [{ id: "cap-ui", title: "1 · Cart ui", covers: ["packages/cart/src/ui/menu.ts", "packages/cart/src/ui/sidebar.tsx"], contracts: [] }],
    "story-pay": [{ id: "cap-plain", title: "2 · Planned before covers", contracts: [] }],
  };
  const explored = { arcs: [], stories: tree.stories.map((story) => ({ ...story, capabilities: capabilities[story.id] ?? [] })) } as unknown as AnnotatedTree;
  const { shop, trunk, done } = await fixture();
  try {
    const survey = await codeSurveyReader({ checkout: "current" }).read(trunk, explored, [{ folder: shop, repository: SHOP_REPOSITORY }]);
    const byFolder = await crossingsOf(explored, survey, trunk, { patterns: ["packages/cart/src/ui"] });
    for (const named of ["cap:cap-ui", "cap:1"]) {
      const byCapability = await crossingsOf(explored, survey, trunk, { patterns: [named] });
      assert.equal(byCapability.inside, 2, `${named} takes the two files it covers`);
      assert.deepEqual(byCapability.stories, ["@shop/cart"]);
      assert.deepEqual({ in: byCapability.in, out: byCapability.out }, { in: byFolder.in, out: byFolder.out }, "the same line as its folder");
    }
    await assert.rejects(crossingsOf(explored, survey, trunk, { patterns: ["cap:cap-plain"] }), /covers no files/);
    await assert.rejects(crossingsOf(explored, survey, trunk, { patterns: ["cap:nothing"] }), /not a capability/);
    const mixed = await crossingsOf(explored, survey, trunk, { patterns: ["cap:cap-ui", "packages/cart/src/lib"] });
    assert.equal(mixed.inside, 3, "a capability and a folder draw one line");
  } finally {
    await done();
  }
});

test("3.9 a mapped Python island's imports cross a line too: a src.-prefixed import from the project's top, where src/ is itself a package, reaches src/x.py or src/x/__init__.py", async () => {
  const checkbox = await mkdtemp(path.join(tmpdir(), "crossing-checkbox-"));
  const trunk = await mkdtemp(path.join(tmpdir(), "crossing-trunk-"));
  const python = { arcs: [], stories: [{ id: "story-interview", title: "data-interview", capabilities: [], mapped: { from: checkbox, package: ".", folders: ["."] } }] } as unknown as AnnotatedTree;
  try {
    await write(checkbox, {
      "pyproject.toml": "[project]\nname = \"data-interview\"\n\n[tool.pytest.ini_options]\npythonpath = [\".\"]\n",
      "src/__init__.py": "",
      "src/auth.py": "def user():\n    return 1\n",
      "src/db.py": "def connect():\n    return 1\n",
      "src/embed/__init__.py": "def embed(text):\n    return text\n",
      "src/packet.py": "PACKET = 1\n",
      "src/retrieve.py": "from src.db import connect\nfrom src.embed import embed\n\n\ndef search():\n    return embed(connect())\n",
      "src/main.py": "from src.auth import user\nfrom src.db import connect\nimport src.packet\nfrom src.retrieve import search\n",
      "tests/test_retrieve.py": "from src.retrieve import search\n\n\ndef test_search():\n    assert search()\n",
    });
    const survey = await codeSurveyReader({ checkout: "current" }).read(trunk, python, [{ folder: checkbox }]);

    const db = await crossingsOf(python, survey, trunk, { patterns: ["src/db.py"], mode: "show" });
    assert.deepEqual(db.rows?.map(({ from, to }) => `${from} -> ${to}`), ["src/main.py -> src/db.py", "src/retrieve.py -> src/db.py"], "db.py's importers");
    const main = await crossingsOf(python, survey, trunk, { patterns: ["src/main.py"], mode: "show" });
    assert.deepEqual(main.rows?.map(({ to }) => to), ["src/auth.py", "src/db.py", "src/packet.py", "src/retrieve.py"], "main.py's imports, import src.packet among them");
    const retrieve = await crossingsOf(python, survey, trunk, { patterns: ["src/retrieve.py"] });
    assert.deepEqual(retrieve.out.island, { files: 1, imports: 2 }, "retrieve.py reaches db.py and the embed package's __init__.py");
    const src = await crossingsOf(python, survey, trunk, { patterns: ["src"] });
    assert.deepEqual(src.in.island, { files: 1, imports: 1 }, "the test outside src imports retrieve.py");

    // A package mapped in a subfolder of its import resolves from that folder, not the import's top.
    await write(checkbox, { "services/api/src/__init__.py": "", "services/api/src/store.py": "X = 1\n", "services/api/src/app.py": "from src.store import X\n" });
    const nested = { arcs: [], stories: [{ id: "story-api", title: "api", capabilities: [], mapped: { from: checkbox, package: "services/api", folders: ["services/api"] } }] } as unknown as AnnotatedTree;
    const store = await crossingsOf(nested, await codeSurveyReader({ checkout: "current" }).read(trunk, nested, [{ folder: checkbox }]), trunk, { patterns: ["services/api/src/store.py"], mode: "show" });
    assert.deepEqual(store.rows?.map(({ from, to }) => `${from} -> ${to}`), ["services/api/src/app.py -> services/api/src/store.py"]);
  } finally {
    await rm(checkbox, { recursive: true, force: true });
    await rm(trunk, { recursive: true, force: true });
  }
});

/**
 * Capability 8 · Code survey of mapped stories (ADR-0993 D2, D3, D5): an imported project's packages, read
 * from the folder this machine imports it from, as black boxes. Written against small imports in temporary folders.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { AnnotatedTree } from "@storytree/library";

import { codeSurveyReader } from "./read-survey.js";

const REPOSITORY = "https://example.test/shop.git";

/** A mapped story of `from`, for `package`, holding its code in `folders`. */
const mappedStory = (id: string, title: string, pkg: string, from = REPOSITORY, folders = [pkg]) =>
  ({ id, title, capabilities: [], mapped: { from, package: pkg, folders } });

const tree = { arcs: [], stories: [
  { id: "story-built", title: "Built", capabilities: [] },
  mappedStory("story-root", "shop", "."),
  mappedStory("story-cart", "@shop/cart", "packages/cart"),
  mappedStory("story-pay", "@shop/pay", "packages/pay"),
  mappedStory("story-away", "away", ".", "/not/imported/here"),
] } as unknown as AnnotatedTree;

/** Write `files` (path from `root` to text) under `root`. */
async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", windowsHide: true }).trim();
const commit = (cwd: string) => {
  git(cwd, "add", ".");
  git(cwd, "-c", "user.name=Survey test", "-c", "user.email=survey@example.test", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
};

/** An imported shop: a workspace root with two packages, each depending on the other. */
const SHOP = {
  "package.json": JSON.stringify({ name: "shop", workspaces: ["packages/*"] }),
  "scripts/build.mjs": "export const build = 1;\n",
  "README.md": "# Shop\n",
  "packages/cart/package.json": JSON.stringify({ name: "@shop/cart", dependencies: { "@shop/pay": "1.0.0", lodash: "4" } }),
  "packages/cart/src/index.ts": "import { pay } from \"@shop/pay\";\n\nexport const cart = () => pay();\n\n\nexport default cart;\n",
  "packages/cart/src/util.js": "module.exports = 1;\n",
  "packages/cart/src/index.test.ts": "test(\"1.1 a cart\", () => {});\n",
  "packages/cart/dist/bundle.js": "var a = 1;\nvar b = 2;\n",
  "packages/pay/package.json": JSON.stringify({ name: "@shop/pay", peerDependencies: { "@shop/cart": "1.0.0" } }),
  "packages/pay/lib/pay.mjs": "export const pay = () => 1;\n",
};

test("8.20 a mapped story is surveyed from the folder this machine imports it from: the tracked JavaScript and TypeScript files under its folders, each with its non-blank lines and no capability", async () => {
  const shop = await mkdtemp(path.join(tmpdir(), "mapped-survey-"));
  const trunk = await mkdtemp(path.join(tmpdir(), "mapped-trunk-"));
  try {
    await write(shop, SHOP);
    git(shop, "init", "-q", "-b", "main");
    commit(shop);
    await write(shop, { "packages/cart/src/untracked.ts": "export const loose = 1;\n" });
    const survey = await codeSurveyReader({ checkout: "current" }).read(trunk, tree, [{ folder: shop, repository: REPOSITORY }]);

    assert.deepEqual(survey["story-cart"]?.files, [
      { path: "packages/cart/src/index.test.ts", lines: 1 },
      { path: "packages/cart/src/index.ts", lines: 3 },
      { path: "packages/cart/src/util.js", lines: 1 },
    ], "tracked code only, no skipped folder, no capability, tests counted as the island's files");
    assert.equal(survey["story-cart"]?.mapped?.folder, shop);
    assert.deepEqual(survey["story-root"]?.files, [{ path: "scripts/build.mjs", lines: 1 }], "the root package leaves out the folders its import's other packages map");
    assert.deepEqual(survey["story-cart"]?.imports, []);
    assert.equal(survey["story-away"], undefined, "an import this machine does not name has no survey");
    assert.equal(survey["story-built"], undefined, "a built story with no package is absent, as before");

    const byFolder = await codeSurveyReader({ checkout: "current" }).read(trunk, { ...tree, stories: tree.stories.map((story) => story.mapped === undefined ? story : { ...story, mapped: { ...story.mapped, from: shop } }) }, [{ folder: shop, repository: REPOSITORY }]);
    assert.equal(byFolder["story-pay"]?.files.length, 1, "an import is found by its folder too, as a local import is keyed");
  } finally {
    await rm(shop, { recursive: true, force: true });
    await rm(trunk, { recursive: true, force: true });
  }
});

test("8.21 a mapped story's package dependency on another mapped story's package is a road; a loop among them is reported and refuses nothing", async () => {
  const shop = await mkdtemp(path.join(tmpdir(), "mapped-roads-"));
  const trunk = await mkdtemp(path.join(tmpdir(), "mapped-trunk-"));
  try {
    await write(shop, SHOP);
    const survey = await codeSurveyReader({ checkout: "current" }).read(trunk, tree, [{ folder: shop, repository: REPOSITORY }]);
    assert.deepEqual(survey["story-cart"]?.dependsOn, ["story-pay"]);
    assert.deepEqual(survey["story-pay"]?.dependsOn, ["story-cart"]);
    assert.deepEqual(survey["story-root"]?.dependsOn, []);
    assert.deepEqual(survey["story-cart"]?.mapped?.loop, ["story-cart", "story-pay"]);
    assert.deepEqual(survey["story-pay"]?.mapped?.loop, ["story-pay", "story-cart"]);
    assert.equal(survey["story-root"]?.mapped?.loop, undefined);
    assert.equal(survey["story-cart"]?.files.length, 3, "a folder that is no checkout is read whole, but for the skip list");
  } finally {
    await rm(shop, { recursive: true, force: true });
    await rm(trunk, { recursive: true, force: true });
  }
});

test("8.22 surveying again at the same commit keeps each mapped story's survey; a new commit reads only what changed", async () => {
  const shop = await mkdtemp(path.join(tmpdir(), "mapped-again-"));
  const trunk = await mkdtemp(path.join(tmpdir(), "mapped-trunk-"));
  try {
    await write(shop, SHOP);
    git(shop, "init", "-q", "-b", "main");
    commit(shop);
    const imports = [{ folder: shop, repository: REPOSITORY }];
    const reader = codeSurveyReader({ checkout: "current" });
    const first = await reader.read(trunk, tree, imports);
    const second = await reader.read(trunk, tree, imports);
    assert.equal(second["story-cart"], first["story-cart"], "the same commit keeps the survey");
    assert.equal(second["story-pay"], first["story-pay"]);

    await write(shop, { "packages/cart/src/util.js": "module.exports = 1;\nmodule.exports.two = 2;\n" });
    commit(shop);
    const third = await reader.read(trunk, tree, imports);
    assert.equal(third["story-cart"]?.files.find((file) => file.path === "packages/cart/src/util.js")?.lines, 2);
    assert.equal(third["story-pay"], first["story-pay"], "an island whose files did not change keeps its survey");
  } finally {
    await rm(shop, { recursive: true, force: true });
    await rm(trunk, { recursive: true, force: true });
  }
});

test("8.22 an imported folder that is no checkout is read again only where a file changed", async () => {
  const shop = await mkdtemp(path.join(tmpdir(), "mapped-disk-"));
  const trunk = await mkdtemp(path.join(tmpdir(), "mapped-trunk-"));
  try {
    await write(shop, SHOP);
    const read: string[] = [];
    const reader = codeSurveyReader({ checkout: "current", readFile: (file) => (read.push(file), readFile(file, "utf8")) });
    const imports = [{ folder: shop, repository: REPOSITORY }];
    const first = await reader.read(trunk, tree, imports);
    assert.ok(read.length > 0);
    read.length = 0;
    const second = await reader.read(trunk, tree, imports);
    assert.deepEqual(read, []);
    assert.equal(second["story-cart"], first["story-cart"]);

    await write(shop, { "packages/pay/lib/pay.mjs": "export const pay = () => 1;\nexport const refund = () => 0;\n" });
    const third = await reader.read(trunk, tree, imports);
    assert.deepEqual(read, [path.join(shop, "packages/pay/lib/pay.mjs")]);
    assert.equal(third["story-pay"]?.files[0]?.lines, 2);
    assert.equal(third["story-cart"], first["story-cart"]);
  } finally {
    await rm(shop, { recursive: true, force: true });
    await rm(trunk, { recursive: true, force: true });
  }
});

test("8.23 a built story's package dependency on a mapped story's package is a road from it to the mapped story; no road ever runs from a mapped story to a built one", async () => {
  const shop = await mkdtemp(path.join(tmpdir(), "mapped-built-"));
  const trunk = await mkdtemp(path.join(tmpdir(), "mapped-trunk-"));
  try {
    // The old code names the new package too (ADR-0993 D9): still no road that way.
    await write(shop, { ...SHOP, "packages/pay/package.json": JSON.stringify({ name: "@shop/pay", dependencies: { "@x/built": "1.0.0" } }) });
    await write(trunk, {
      "packages/built/package.json": JSON.stringify({ name: "@x/built", dependencies: { "@shop/cart": `link:${path.join(shop, "packages/cart")}` } }),
      "packages/built/src/index.ts": "import { cart } from \"@shop/cart/src/index\";\nexport const built = () => cart();\n",
    });
    const survey = await codeSurveyReader({ checkout: "current" }).read(trunk, tree, [{ folder: shop, repository: REPOSITORY }]);
    assert.deepEqual(survey["story-built"]?.dependsOn, ["story-cart"]);
    assert.deepEqual(survey["story-pay"]?.dependsOn, []);
  } finally {
    await rm(shop, { recursive: true, force: true });
    await rm(trunk, { recursive: true, force: true });
  }
});

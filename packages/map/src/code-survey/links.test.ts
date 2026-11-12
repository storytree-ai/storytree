/**
 * Capability 3 · Counts before detail: a mapped story's links checked against its code's imports (question_23191b4f2a29,
 * option D). Written against a small import in a temporary folder.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import type { AnnotatedTree } from "@storytree/library";

import { formatLinks, linksOf } from "./links.js";
import { codeSurveyReader } from "./read-survey.js";

const REPOSITORY = "https://example.test/shop.git";

const capability = (id: string, title: string, dependsOn: string[], covers?: string[]) =>
  ({ id, title, dependsOn, contracts: [], ...(covers === undefined ? {} : { covers }) });

/** A shop mapped into four explored capabilities and one that covers nothing; a file in none imports the lib. */
const tree = { arcs: [], stories: [
  { id: "story-built", title: "Built", capabilities: [] },
  { id: "story-shop", title: "shop", mapped: { from: REPOSITORY, package: ".", folders: ["."] }, capabilities: [
    capability("cap-ui", "1 · Ui", ["cap-store", "cap-plain"], ["src/ui"]),
    capability("cap-lib", "2 · Lib", [], ["src/lib"]),
    capability("cap-store", "3 · Store", [], ["src/store"]),
    capability("cap-api", "4 · Api", ["cap-lib"], ["src/api/handler.ts"]),
    capability("cap-plain", "5 · Planned before covers", []),
  ] },
] } as unknown as AnnotatedTree;

const SHOP = {
  "package.json": JSON.stringify({ name: "shop" }),
  "src/ui/menu.ts": "import { format } from \"../lib/format.js\";\nexport const menu = format(1);\n",
  "src/ui/sidebar.ts": "import { format } from \"../lib/format.js\";\nimport { menu } from \"./menu.js\";\nexport const sidebar = format(menu);\n",
  "src/lib/format.ts": "export const format = (value: unknown) => String(value);\n",
  "src/store/cart.ts": "import { menu } from \"../ui/menu.js\";\n// import { format } from \"../lib/format.js\";\nexport const cart = menu;\n",
  "src/api/handler.ts": "import { format } from \"../lib/format.js\";\nexport const handle = format;\n",
  "src/index.ts": "import { format } from \"./lib/format.js\";\nexport const shop = format;\n",
};

test("3.15 for an imported story the map lists each import between two explored capabilities' files that no link covers, and each link between two of them that no import backs, with the imports behind each; a link it cannot check is named", async () => {
  const shop = await mkdtemp(path.join(tmpdir(), "links-shop-"));
  const trunk = await mkdtemp(path.join(tmpdir(), "links-trunk-"));
  try {
    for (const [file, text] of Object.entries(SHOP)) {
      await mkdir(path.dirname(path.join(shop, file)), { recursive: true });
      await writeFile(path.join(shop, file), text);
    }
    const survey = await codeSurveyReader({ checkout: "current" }).read(trunk, tree, [{ folder: shop, repository: REPOSITORY }]);

    const answer = await linksOf(tree, survey, trunk, "story:shop");
    assert.deepEqual(answer.story, { id: "story-shop", title: "shop" });
    assert.equal(answer.explored, 4, "the capability covering nothing is not explored");
    assert.deepEqual(answer.missing, [
      { from: { id: "cap-ui", title: "1 · Ui" }, to: { id: "cap-lib", title: "2 · Lib" }, count: 2, imports: [{ from: "src/ui/menu.ts", to: "src/lib/format.ts" }, { from: "src/ui/sidebar.ts", to: "src/lib/format.ts" }] },
      { from: { id: "cap-store", title: "3 · Store" }, to: { id: "cap-ui", title: "1 · Ui" }, count: 1, imports: [{ from: "src/store/cart.ts", to: "src/ui/menu.ts" }] },
    ], "the api's import of the lib is backed by its link; imports within a capability, from a file in none, and a commented one are none");
    assert.deepEqual(answer.unbacked, [
      { from: { id: "cap-ui", title: "1 · Ui" }, to: { id: "cap-store", title: "3 · Store" }, count: 0, imports: [], reverse: [{ from: "src/store/cart.ts", to: "src/ui/menu.ts" }] },
    ], "the ui depends on the store, but only the store imports the ui");
    assert.deepEqual(answer.unchecked, [
      { from: { id: "cap-ui", title: "1 · Ui" }, to: { id: "cap-plain", title: "5 · Planned before covers" }, why: "5 · Planned before covers covers no files" },
    ]);
    assert.match(answer.note, /database or events/);

    const text = formatLinks(answer);
    assert.match(text, /Missing links \(imports no link covers\): 2/);
    assert.match(text, /1 · Ui -> 2 · Lib: 2 imports\n {4}src\/ui\/menu\.ts -> src\/lib\/format\.ts/);
    assert.match(text, /Unbacked links \(no import backs them\): 1\n {2}1 · Ui -> 3 · Store; imports run the other way:\n {4}src\/store\/cart\.ts -> src\/ui\/menu\.ts/);

    const capped = await linksOf(tree, survey, trunk, "story:shop", { ceiling: 2 });
    assert.equal(capped.refused, true);
    assert.deepEqual(capped.missing.map(({ imports, count }) => [imports.length, count]), [[0, 2], [0, 1]], "above the ceiling each link keeps its count, never a cut list");

    await assert.rejects(linksOf(tree, survey, trunk, "story:Built"), /not an imported story/);
  } finally {
    await rm(shop, { recursive: true, force: true });
    await rm(trunk, { recursive: true, force: true });
  }
});

/** The desktop app's bundles pack each host's parts from the list Plugin loader's step writes, never from its code. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import { removeTemp } from "@storytree/test-waits";

import { partsFromList, writeWithPluginLoader } from "./parts-list.js";

interface Story { readonly name: string; readonly dependencies?: readonly string[]; readonly surfaces?: { readonly ids: readonly string[]; readonly order: number }; readonly files?: Record<string, string> }

/** A folder holding a host that imports #parts/surfaces, with each story installed in its node_modules. */
function host(t: TestContext, stories: readonly Story[], dependencies = stories.map((story) => story.name)): string {
  const root = mkdtempSync(path.join(tmpdir(), "storytree-desktop-parts-list-"));
  t.after(() => removeTemp(root));
  const imports = { "#parts/surfaces": "./src/surfaces.js" };
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "host", imports, dependencies: Object.fromEntries(dependencies.map((name) => [name, "*"])) }));
  for (const story of stories) {
    const dir = path.join(root, "node_modules", ...story.name.split("/"));
    mkdirSync(dir, { recursive: true });
    const exported = `${story.name.split("/")[1]}Surfaces`;
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({
      name: story.name,
      type: "module",
      exports: { ".": "./index.js", "./surfaces": "./surfaces.js" },
      dependencies: Object.fromEntries((story.dependencies ?? []).map((name) => [name, "*"])),
      ...(story.files === undefined ? {} : { imports }),
      ...(story.surfaces === undefined ? {} : { storytree: { surfaces: [{ from: "./surfaces", export: exported, order: story.surfaces.order }] } }),
    }));
    writeFileSync(path.join(dir, "surfaces.js"), `export const ${exported} = ${JSON.stringify((story.surfaces?.ids ?? []).map((id) => ({ id })))};\n`);
    for (const [file, text] of Object.entries(story.files ?? {})) writeFileSync(path.join(dir, file), text);
  }
  mkdirSync(path.join(root, "src"));
  return root;
}

/** Bundle `entry` in `dir` with the parts list, and import what it exports once the node_modules it came from are gone. */
async function bundle<T>(dir: string, entry: string, plugin = partsFromList()): Promise<T> {
  writeFileSync(path.join(dir, "src", "entry.js"), entry);
  const outfile = path.join(dir, "out.mjs");
  await build({ entryPoints: [path.join(dir, "src", "entry.js")], outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent", absWorkingDir: dir, plugins: [plugin] });
  rmSync(path.join(dir, "node_modules"), { recursive: true, force: true });
  return await import(pathToFileURL(outfile).href) as T;
}

const arcs: Story = { name: "@s/arcs", surfaces: { ids: ["arcs"], order: 2 } };
const forest: Story = { name: "@s/forest", surfaces: { ids: ["globe", "library"], order: 1 } };

test("1.48 · the main process and preload bundles pack each #parts/<kind> from the parts list Plugin loader's step writes for the importing file's package, in its order with each part's owner and the host's parts graph", async (t) => {
  const dir = host(t, [arcs, forest]);
  const bundled = await bundle<{ surfaces: { parts: unknown; owners: unknown; graph: unknown } }>(dir, `import surfaces from "#parts/surfaces";\nexport { surfaces };\n`);
  assert.deepEqual(bundled.surfaces.parts, [{ id: "globe" }, { id: "library" }, { id: "arcs" }]);
  assert.deepEqual(bundled.surfaces.owners, ["forest", "forest", "arcs"]);
  assert.deepEqual(bundled.surfaces.graph, { arcs: [], forest: [] });
});

test("1.48 · a desktop bundle whose parts list is missing, or out of date with a package.json it was written from, fails naming it rather than pack the wrong parts, and so does one importing a kind its package.json maps no list for", async (t) => {
  const entry = `import surfaces from "#parts/surfaces";\nexport { surfaces };\n`;
  const missing = host(t, [arcs, forest]);
  await assert.rejects(bundle(missing, entry, partsFromList({ write: async () => {} })), /no parts list for .*: Plugin loader's step wrote none/);
  const stale = host(t, [arcs, forest]);
  const changed = path.join(stale, "node_modules", "@s", "arcs", "package.json");
  // The list is written, then a story's manifest changes under it: an install between the step and the pack.
  const write = async (from: string, file: string) => { await writeWithPluginLoader(from, file); writeFileSync(changed, "{}"); };
  await assert.rejects(bundle(stale, entry, partsFromList({ write })), (error: Error) => error.message.includes(`out of date: ${realpathSync(changed)} changed`));
  const unmapped = host(t, [arcs, forest]);
  await assert.rejects(bundle(unmapped, `import pages from "#parts/pages";\nexport { pages };\n`), /holds no #parts\/pages: its package\.json's imports map no such kind/);
});

/** The plugin loader: the manifests a host's story packages carry, and the parts composed from them into its bundle. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

import { composeParts, mount, partsPlugin, storyParts } from "./index.js";

/** The loader's own entry, as a fixture host's composing module imports it (the fixture installs no loader of its own). */
const LOADER = JSON.stringify(new URL("./index.ts", import.meta.url).href);

interface Story { readonly name: string; readonly manifest?: unknown; readonly exports?: Record<string, string>; readonly files?: Record<string, string>; readonly dependencies?: readonly string[] }

/** A host folder depending on the given story packages, each installed in its node_modules. */
function host(t: TestContext, stories: readonly Story[], dependencies = stories.map((story) => story.name)): string {
  const root = mkdtempSync(path.join(tmpdir(), "storytree-plugin-loader-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "host", dependencies: Object.fromEntries(dependencies.map((name) => [name, "*"])) }));
  for (const story of stories) {
    const dir = path.join(root, "node_modules", ...story.name.split("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: story.name, type: "module", exports: story.exports ?? {}, dependencies: Object.fromEntries((story.dependencies ?? []).map((name) => [name, "*"])), ...(story.manifest === undefined ? {} : { storytree: story.manifest }) }));
    for (const [file, text] of Object.entries(story.files ?? {})) writeFileSync(path.join(dir, file), text);
  }
  return root;
}

const surfaces = (name: string, exported: string, ids: readonly string[], order?: number, dependencies?: readonly string[]): Story => ({
  name,
  ...(dependencies === undefined ? {} : { dependencies }),
  exports: { ".": "./index.js", "./surfaces": "./surfaces.js" },
  manifest: { surfaces: [{ from: "./surfaces", export: exported, ...(order === undefined ? {} : { order }) }] },
  files: { "surfaces.js": `export const ${exported} = ${JSON.stringify(ids.map((id) => ({ id })))};\n` },
});

test("1.1 storyParts names each part of a kind the host's story packages' manifests declare; a package with no manifest, or none for that kind, adds nothing", (t) => {
  const dir = host(t, [
    surfaces("@s/forest", "forestSurfaces", ["globe"], 1),
    { name: "@s/plain", exports: { ".": "./index.js" } },
    { name: "@s/verbs-only", exports: { "./verbs": "./verbs.js" }, manifest: { verbs: [{ from: "./verbs", export: "verbs" }] } },
  ]);
  assert.deepEqual(storyParts(dir, "surfaces"), [{ package: "@s/forest", module: "@s/forest/surfaces", export: "forestSurfaces" }]);
  assert.deepEqual(storyParts(dir, "pages"), []);
});

test("1.2 a manifest part naming a subpath its package does not export, or no export name, is refused, naming the package and the part", (t) => {
  const unexported = host(t, [{ name: "@s/forest", exports: { ".": "./index.js" }, manifest: { surfaces: [{ from: "./surfaces", export: "forestSurfaces" }] } }]);
  assert.throws(() => storyParts(unexported, "surfaces"), /@s\/forest.*"\.\/surfaces".*does not export/);
  const unnamed = host(t, [{ name: "@s/forest", exports: { "./surfaces": "./surfaces.js" }, manifest: { surfaces: [{ from: "./surfaces" }] } }]);
  assert.throws(() => storyParts(unnamed, "surfaces"), /@s\/forest.*"\.\/surfaces".*export name/);
});

test("1.3 storyParts orders parts by their manifest's order, unordered last, ties by package name then manifest position, whatever order the host lists them in", (t) => {
  const stories = [surfaces("@s/zeta", "z", ["z"]), surfaces("@s/arcs", "arcSurfaces", ["arcs"], 2), surfaces("@s/alpha", "a", ["a"]), surfaces("@s/forest", "forestSurfaces", ["globe"], 1)];
  const dir = host(t, stories, ["@s/zeta", "@s/arcs", "@s/alpha", "@s/forest"]);
  assert.deepEqual(storyParts(dir, "surfaces").map((part) => part.export), ["forestSurfaces", "arcSurfaces", "a", "z"]);
});

test("2.1 a bundle importing #parts/<kind> gets every part's declarations, concatenated in storyParts' order, the host being the importing file's package, and an empty list for a kind no manifest names", async (t) => {
  const dir = host(t, [surfaces("@s/arcs", "arcSurfaces", ["arcs"], 2), surfaces("@s/forest", "forestSurfaces", ["globe", "library"], 1)]);
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "entry.js"), `import surfaces from "#parts/surfaces";\nimport pages from "#parts/pages";\nexport { surfaces, pages };\n`);
  const outfile = path.join(dir, "out.mjs");
  await build({ entryPoints: [path.join(dir, "src", "entry.js")], outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent", absWorkingDir: dir, plugins: [partsPlugin()] });
  rmSync(path.join(dir, "node_modules"), { recursive: true, force: true });
  const bundled = await import(pathToFileURL(outfile).href) as { surfaces: { parts: unknown; owners: unknown }; pages: { parts: unknown } };
  assert.deepEqual(bundled.surfaces.parts, [{ id: "globe" }, { id: "library" }, { id: "arcs" }]);
  assert.deepEqual(bundled.surfaces.owners, ["forest", "forest", "arcs"]);
  assert.deepEqual(bundled.pages.parts, []);
});

test("3.1 an unbundled host importing #parts/<kind>, which its imports map to its own module calling composeParts, gets every part's declarations in storyParts' order, and an empty list for a kind no manifest names", async (t) => {
  const dir = host(t, [surfaces("@s/arcs", "arcSurfaces", ["arcs"], 2), surfaces("@s/forest", "forestSurfaces", ["globe", "library"], 1)]);
  const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as Record<string, unknown>;
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ ...manifest, type: "module", imports: { "#parts/surfaces": "./src/parts/surfaces.js", "#parts/pages": "./src/parts/pages.js" } }));
  mkdirSync(path.join(dir, "src", "parts"), { recursive: true });
  for (const kind of ["surfaces", "pages"]) {
    writeFileSync(path.join(dir, "src", "parts", `${kind}.js`), `import { composeParts } from ${LOADER};\nexport default await composeParts(import.meta.url, ${JSON.stringify(kind)});\n`);
  }
  writeFileSync(path.join(dir, "src", "entry.js"), `import surfaces from "#parts/surfaces";\nimport pages from "#parts/pages";\nexport { surfaces, pages };\n`);
  const composed = await import(pathToFileURL(path.join(dir, "src", "entry.js")).href) as { surfaces: { parts: unknown; owners: unknown }; pages: { parts: unknown } };
  assert.deepEqual(composed.surfaces.parts, [{ id: "globe" }, { id: "library" }, { id: "arcs" }]);
  assert.deepEqual(composed.surfaces.owners, ["forest", "forest", "arcs"]);
  assert.deepEqual(composed.pages.parts, []);
});

test("4.1 a composed list names the part each declaration came from, by package name without its scope, and the host's parts graph: each package with a manifest and those of them it depends on", async (t) => {
  const dir = host(t, [
    surfaces("@s/forest", "forestSurfaces", ["globe", "library"], 1, ["@s/library", "left-pad"]),
    surfaces("@s/arcs", "arcSurfaces", ["arcs"], 2, ["@s/forest"]),
    { name: "@s/library", exports: { ".": "./index.js" }, manifest: {} },
    { name: "left-pad", exports: { ".": "./index.js" } },
  ]);
  const composed = await composeParts(path.join(dir, "entry.js"), "surfaces");
  assert.deepEqual(composed.owners, ["forest", "forest", "arcs"]);
  assert.deepEqual(composed.graph, { arcs: ["forest"], forest: ["library"], library: [] });
});

test("4.2 a host mounts every declaration but those of a part the setting names off and of every part standing on it, however deep, each said off because of the named one; the core and names the host lacks are ignored", () => {
  const composition = {
    parts: ["globe", "arcs", "lag", "card", "settings"],
    owners: ["forest", "arc-surface", "lag", "library", "project-and-caller"],
    graph: { forest: ["library"], "arc-surface": ["forest"], lag: ["arc-surface"], library: [], "project-and-caller": ["library"] },
  };
  assert.deepEqual(mount(composition, ["forest", "library", "project-and-caller", "no-such"]), {
    mounted: ["card", "settings"],
    off: [{ part: "arc-surface", because: "forest" }, { part: "forest", because: "forest" }, { part: "lag", because: "forest" }],
  });
  assert.deepEqual(mount(composition, []), { mounted: composition.parts, off: [] });
});

/** The plugin loader: the manifests a host's story packages carry, and the parts composed from them into its bundle. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

import { composeParts, mount, offSaid, partsPlugin, PLUGIN_INTERFACE, pluginExport, standIn, storyParts } from "./index.js";

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

test("2.1 two hosts in one bundle importing the same #parts/<kind> each get their own parts, the host being each importing file's package", async (t) => {
  // A story package that is itself a host, mounting its own dependencies' parts, bundled into another host.
  const inner: Story = {
    name: "@s/inner",
    dependencies: ["@s/arcs"],
    exports: { ".": "./index.js" },
    files: { "index.js": `import surfaces from "#parts/surfaces";\nexport { surfaces };\n` },
  };
  const dir = host(t, [surfaces("@s/arcs", "arcSurfaces", ["arcs"], 2), surfaces("@s/forest", "forestSurfaces", ["globe"], 1), inner], ["@s/arcs", "@s/forest", "@s/inner"]);
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "entry.js"), `import surfaces from "#parts/surfaces";\nimport { surfaces as inner } from "@s/inner";\nexport { surfaces, inner };\n`);
  const outfile = path.join(dir, "out.mjs");
  await build({ entryPoints: [path.join(dir, "src", "entry.js")], outfile, bundle: true, format: "esm", platform: "node", logLevel: "silent", absWorkingDir: dir, plugins: [partsPlugin()] });
  rmSync(path.join(dir, "node_modules"), { recursive: true, force: true });
  const bundled = await import(pathToFileURL(outfile).href) as { surfaces: { parts: unknown }; inner: { parts: unknown } };
  assert.deepEqual(bundled.surfaces.parts, [{ id: "globe" }, { id: "arcs" }], "the outer host's dependencies' parts");
  assert.deepEqual(bundled.inner.parts, [{ id: "arcs" }], "the inner host's own dependencies' parts, not the outer's");
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

test("4.1 a composed list names the part each declaration came from, by package name without its scope, and the host's parts graph: each package with a manifest, those it reaches only through one of them included, and the parts it depends on", async (t) => {
  const dir = host(t, [
    surfaces("@s/forest", "forestSurfaces", ["globe", "library"], 1, ["@s/library", "@s/friction", "left-pad"]),
    surfaces("@s/arcs", "arcSurfaces", ["arcs"], 2, ["@s/forest"]),
    { name: "@s/library", exports: { ".": "./index.js" }, manifest: {} },
    { name: "@s/friction", exports: { ".": "./index.js" }, manifest: {}, dependencies: ["@s/library"] },
    { name: "left-pad", exports: { ".": "./index.js" } },
  ], ["@s/forest", "@s/arcs", "@s/library", "left-pad"]);
  const composed = await composeParts(path.join(dir, "entry.js"), "surfaces");
  assert.deepEqual(composed.owners, ["forest", "forest", "arcs"]);
  assert.deepEqual(composed.graph, { arcs: ["forest"], forest: ["friction", "library"], friction: ["library"], library: [] });
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

/** A factory folder holding the given plugins, each `plugins/<name>/` with its package.json and files. */
function factory(t: TestContext, plugins: Readonly<Record<string, { manifest?: unknown; exports?: Record<string, string>; files?: Record<string, string> }>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "storytree-factory-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, plugin] of Object.entries(plugins)) {
    const dir = path.join(root, "plugins", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, type: "module", exports: plugin.exports ?? {}, ...(plugin.manifest === undefined ? {} : { storytree: plugin.manifest }) }));
    for (const [file, text] of Object.entries(plugin.files ?? {})) writeFileSync(path.join(dir, file), text);
  }
  return root;
}

const builtIn = {
  parts: ["health", "globe"],
  owners: ["ci-health", "forest"],
  graph: { "ci-health": ["library"], forest: ["library"], library: [] },
};

const verbsPlugin = { exports: { "./verbs": "./verbs.js" }, manifest: { interface: PLUGIN_INTERFACE, verbs: [{ from: "./verbs", export: "verbs" }] }, files: { "verbs.js": `export const verbs = ["my-health"];\n` } };

test("5.1 a factory plugin named to stand in for a part is loaded from the factory folder and mounted where the part's declarations were while that part is switched off, and not at all once it is on; a kind it does not name adds nothing", (t) => {
  const folder = factory(t, { "my-health": verbsPlugin });
  const composed = standIn(builtIn, "verbs", { folder, plugins: { "ci-health": "my-health" } });
  assert.deepEqual(mount(composed, ["ci-health"]), { mounted: ["my-health", "globe"], off: [{ part: "ci-health", because: "ci-health" }] });
  assert.deepEqual(mount(composed, []).mounted, ["health", "globe"], "switched back on, the built-in part mounts and the plugin does not");
  assert.deepEqual(mount(standIn(builtIn, "surfaces", { folder, plugins: { "ci-health": "my-health" } }), ["ci-health"]).mounted, ["globe"]);
});

test("5.2 a stand-in that cannot be loaded (no factory folder, no such plugin, no manifest, an unexported module, no list) leaves its part off, said with why, and the host still mounts the rest", (t) => {
  const folder = factory(t, {
    bare: {},
    unexported: { manifest: { interface: PLUGIN_INTERFACE, verbs: [{ from: "./verbs", export: "verbs" }] } },
    "not-a-list": { ...verbsPlugin, files: { "verbs.js": `export const verbs = "my-health";\n` } },
  });
  for (const [where, plugin, why] of [
    [undefined, "my-health", /no factory folder is chosen/],
    [folder, "missing", /no plugin called missing/],
    [folder, "bare", /no storytree manifest/],
    [folder, "unexported", /does not export/],
    [folder, "not-a-list", /no list called verbs/],
  ] as const) {
    const result = mount(standIn(builtIn, "verbs", { ...(where === undefined ? {} : { folder: where }), plugins: { "ci-health": plugin } }), ["ci-health"]);
    assert.deepEqual(result.mounted, ["globe"]);
    assert.equal(result.off[0]!.part, "ci-health");
    assert.match(result.off[0]!.failed ?? "", why);
    assert.match(offSaid(result.off[0]!), new RegExp(`stand-in ${plugin} could not be loaded`));
  }
});

test("5.3 a factory plugin's manifest names the version of storytree's plugin interface it was written for: one this host honours is mounted, and one naming another version, or none, is left unmounted with its part off, said with the version it named and the one this host honours", (t) => {
  const folder = factory(t, {
    "my-health": verbsPlugin,
    later: { ...verbsPlugin, manifest: { ...verbsPlugin.manifest, interface: PLUGIN_INTERFACE + 1 } },
    unversioned: { ...verbsPlugin, manifest: { verbs: verbsPlugin.manifest.verbs } },
  });
  assert.deepEqual(mount(standIn(builtIn, "verbs", { folder, plugins: { "ci-health": "my-health" } }), ["ci-health"]).mounted, ["my-health", "globe"]);
  for (const [plugin, why] of [
    ["later", new RegExp(`written for storytree's plugin interface ${PLUGIN_INTERFACE + 1}; this storytree honours interface ${PLUGIN_INTERFACE}`)],
    ["unversioned", new RegExp(`names no plugin interface version; this storytree honours interface ${PLUGIN_INTERFACE}`)],
  ] as const) {
    const result = mount(standIn(builtIn, "verbs", { folder, plugins: { "ci-health": plugin } }), ["ci-health"]);
    assert.deepEqual(result.mounted, ["globe"]);
    assert.match(offSaid(result.off[0]!), new RegExp(`stand-in ${plugin} could not be loaded`));
    assert.match(result.off[0]!.failed ?? "", why);
  }
});

test("5.4 a plugin's exported file is found by its export name inside the plugin's own folder; an unexported name, a target reaching outside the plugin, or a plugin name that is not one folder is refused with why", (t) => {
  const folder = factory(t, {
    "my-health": { ...verbsPlugin, exports: { ...verbsPlugin.exports, "./view": "./view.js", "./escape": "../other/secret.js" }, files: { ...verbsPlugin.files, "view.js": "export function mount() {}\n" } },
    other: { files: { "secret.js": "export const secret = 1;\n" } },
  });
  assert.equal(pluginExport(folder, "my-health", "./view"), path.join(folder, "plugins", "my-health", "view.js"));
  for (const [plugin, from, why] of [
    ["my-health", "./view.js", /does not export "\.\/view\.js"/],
    ["my-health", "./escape", /outside its own folder/],
    ["..", "./view", /not a plugin's name/],
    ["my-health/../other", "./view", /not a plugin's name/],
    ["missing", "./view", /no plugin called missing/],
  ] as const) assert.throws(() => pluginExport(folder, plugin, from), why);
  assert.throws(() => pluginExport(undefined, "my-health", "./view"), /no factory folder is chosen/);
});

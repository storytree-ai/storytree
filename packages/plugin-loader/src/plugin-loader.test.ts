/** The plugin loader: the manifests a host's story packages carry, and the parts composed from them into its bundle. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

import { pluginSchema, type PluginRecords } from "@storytree/library";

import { checkPlugin } from "./factory/contract.js";
import { pluginServices, type ServiceHost } from "./factory/factory.js";
import { composeParts, mount, offSaid, partsPlugin, PLUGIN_INTERFACE, pluginExport, recordKinds, standIn, storyParts, storyServices } from "./index.js";

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

test("1.4 · storyServices names each service the manifests of the host's story packages declare, with its name and how it runs; one with no name, a run but \"always\" or { every: \"<n>m\" }, or an unexported from is refused, naming the package", (t) => {
  const services = (entries: unknown): Story => ({ name: "@s/voice", exports: { "./services": "./services.js" }, manifest: { services: entries } });
  const dir = host(t, [services([{ name: "listen", from: "./services", export: "listen", run: "always" }, { name: "commit", from: "./services", export: "commit", run: { every: "15m" } }]), surfaces("@s/forest", "forestSurfaces", ["globe"])]);
  assert.deepEqual(storyServices(dir), [
    { package: "@s/voice", name: "listen", run: "always", module: "@s/voice/services", export: "listen" },
    { package: "@s/voice", name: "commit", run: { every: "15m" }, module: "@s/voice/services", export: "commit" },
  ]);
  for (const [entries, refusal] of [
    [[{ from: "./services", export: "listen", run: "always" }], /@s\/voice.*service 1 has no name/],
    [[{ name: "listen", from: "./services", export: "listen", run: "sometimes" }], /@s\/voice.*listen runs "sometimes"/],
    [[{ name: "listen", from: "./elsewhere", export: "listen", run: "always" }], /@s\/voice.*"\.\/elsewhere".*does not export/],
  ] as const) assert.throws(() => storyServices(host(t, [services(entries)])), refusal);
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
    parts: ["globe", "arcs", "lag", "card", "settings", "plugin"],
    owners: ["forest", "arc-surface", "lag", "library", "project-and-caller", "plugin-loader"],
    graph: { forest: ["library"], "arc-surface": ["forest"], lag: ["arc-surface"], library: [], "project-and-caller": ["library"], "plugin-loader": ["library", "project-and-caller"] },
  };
  assert.deepEqual(mount(composition, ["forest", "library", "project-and-caller", "plugin-loader", "no-such"]), {
    mounted: ["card", "settings", "plugin"],
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

/** The plugin family's verbs, by command name, run as the command line runs them, in a storytree home of their own. */
async function pluginVerb(t: TestContext, name: string): Promise<{ act: (input: Record<string, unknown>, context?: object) => Promise<{ text: string; next?: readonly { command?: string; tool?: string }[] }>; tool: unknown; factory: string; home: string }> {
  const home = mkdtempSync(path.join(tmpdir(), "storytree-home-"));
  const before = process.env.STORYTREE_HOME;
  process.env.STORYTREE_HOME = home;
  t.after(() => {
    if (before === undefined) delete process.env.STORYTREE_HOME;
    else process.env.STORYTREE_HOME = before;
    rmSync(home, { recursive: true, force: true });
  });
  const { PLUGIN_FAMILIES } = await import("./factory/verbs.js");
  const found = PLUGIN_FAMILIES[0]!.verbs.find((each) => "name" in each.command && each.command.name === name)!;
  const words = { door: "command" as const, say: (step: { command?: string }) => `storytree ${step.command}` };
  return { act: (input, context = {}) => found.act(input as never, { folder: home, ...context } as never, words), tool: found.tool, factory: path.join(home, "your-factory"), home };
}

test("5.5 `plugin new <plugin>` starts a plugin in this computer's factory folder that this storytree loads: standing in for a part, its family mounts and its verb answers, and its own test command passes its numbered test; a name taken, or one that is not one folder's, is refused, writing nothing", async (t) => {
  const { act, factory } = await pluginVerb(t, "new");
  const answer = await act({ plugin: "my-health", for: "ci-health" });
  assert.match(answer.text, /my-health/);
  assert.ok(answer.next!.some((step) => step.command === "settings set part ci-health plugin my-health"), "it names the switch that mounts it");
  const record = answer.next!.find((step) => step.command === "health plugin my-health");
  assert.ok(record !== undefined && record.tool === undefined, "it names the command that records its tests, which has no tool");
  const { mounted } = mount(standIn<{ name: string; verbs: { act: (input: object, place: object) => Promise<{ text: string }> }[] }>(builtIn as never, "verbs", { folder: factory, plugins: { "ci-health": "my-health" } }), ["ci-health"]);
  const family = mounted[0]!;
  assert.equal(family.name, "my-health");
  assert.match((await family.verbs[0]!.act({}, { folder: "/somewhere" })).text, /my-health is mounted/);
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  const own = spawnSync(process.execPath, ["--test"], { cwd: path.join(factory, "plugins", "my-health"), env, encoding: "utf8" });
  assert.equal(own.status, 0, `its own test command passes its numbered test:\n${own.stdout}${own.stderr}`);
  assert.match(own.stdout, /1\.1 · my-health's hello says it is mounted/);
  await assert.rejects(act({ plugin: "my-health" }), /already/);
  await assert.rejects(act({ plugin: "../escape" }), /not a plugin's name/);
});

test("5.13 · a factory plugin that stands in for no part is added under its own name: `plugin new <plugin>` with no --for, and `plugin check`, name `settings set part <plugin> plugin <plugin>`, and every host mounts it, after its own parts, while the setting names it, and not once it no longer does", async (t) => {
  const { act, factory } = await pluginVerb(t, "new");
  const answer = await act({ plugin: "my-extra" });
  assert.ok(answer.next!.some((step) => step.command === "settings set part my-extra plugin my-extra"), "it names the switch that adds it");
  const { PLUGIN_FAMILIES } = await import("./factory/verbs.js");
  const check = PLUGIN_FAMILIES[0]!.verbs.find((each) => "name" in each.command && each.command.name === "check")!;
  const checked = await check.act({ plugin: "my-extra" } as never, { folder: factory } as never, { door: "command", say: (step) => step.command! });
  assert.ok(checked.next!.some((step) => step.command === "settings set part my-extra plugin my-extra"), "check names it too");
  const added = standIn<{ name: string }>(builtIn as never, "verbs", { folder: factory, plugins: { "my-extra": "my-extra" } });
  assert.deepEqual(mount(added, ["my-extra"]).mounted.map((family) => family.name ?? family), ["health", "globe", "my-extra"]);
  assert.deepEqual(mount(added, ["my-extra"]).off, [], "no part of the host is off for it");
  assert.deepEqual(mount(added, []).mounted, ["health", "globe"], "dropped from the setting, it mounts no more");
});

test("5.6 `plugin check <plugin>` says whether this storytree would load a plugin, and why not, switching nothing: a manifest of another shape, a verbs module exporting a function, a family or verb missing what a door mounts are each refused with why; one that loads is named with what it adds", async (t) => {
  const { act, factory } = await pluginVerb(t, "check");
  const family = (verbs: string) => ({ ...verbsPlugin, files: { "verbs.js": `export const verbs = ${verbs};\n` } });
  const plugins = {
    "wrong-shape": { exports: {}, manifest: { plugin: "wrong-shape", part: "ci-health", entry: "./index.js" }, files: { "index.js": "export default function () {}\n" } },
    "a-function": { ...verbsPlugin, files: { "verbs.js": "export const verbs = function () {};\n" } },
    "no-act": family(`[{ name: "x", summary: "s", order: 40, verbs: [{ command: { family: "x", name: "y", summary: "s" }, tool: { absent: "no" }, inputs: {} }] }]`),
    "no-order": family(`[{ name: "x", summary: "s", verbs: [] }]`),
    "no-name": family(`[{ summary: "s", order: 40, verbs: [] }]`),
    "no-kinds": { exports: {}, manifest: { interface: 1 }, files: {} },
    good: family(`[{ name: "x", summary: "s", order: 40, verbs: [{ command: { family: "x", name: "y", summary: "s" }, tool: { absent: "no" }, inputs: {}, async act() { return { text: "hi" }; } }] }]`),
  };
  for (const [name, plugin] of Object.entries(plugins)) {
    const dir = path.join(factory, "plugins", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, type: "module", exports: plugin.exports ?? {}, storytree: plugin.manifest }));
    for (const [file, text] of Object.entries(plugin.files)) writeFileSync(path.join(dir, file), text);
  }
  for (const [plugin, why] of [
    ["wrong-shape", /names no plugin interface version/],
    ["a-function", /no list called verbs/],
    ["no-act", /has no act/],
    ["no-order", /has no order/],
    ["no-name", /family 1 has no name/],
    ["no-kinds", /names none of the kinds/],
    ["missing", /no plugin called missing/],
  ] as const) assert.match((await act({ plugin })).text, new RegExp(`${plugin} would not load[^]*${why.source}`));
  assert.match((await act({ plugin: "good" })).text, /good would load: it adds verbs \(1\)/);
});

test("5.7 `plugin contract`, on the command line and as a tool, says what a plugin must contain: the interface version this storytree honours, each kind a part can be stood in with, and how it declares its own kinds of record; contract, new and check need no project", async (t) => {
  const { act, tool } = await pluginVerb(t, "contract");
  const { text } = await act({});
  assert.match(text, /"interface": 1\b/);
  for (const kind of ["verbs", "tools", "claimChecks", "pipelineJobs", "projectRecords", "surfaces", "services"]) assert.match(text, new RegExp(`^  ${kind} \\(mounted by`, "m"));
  assert.match(text, /"recordKinds": \[\{ "kind": "<plugin>\.<kind>", "version": 1, "fields": <a JSON Schema of type "object">, "writers"/, "and a plugin's own kinds of record");
  assert.match(text, /"librarian": \{ "role": "<database role>", "update"\?: true \}/, "and its own librarian's role and update right");
  assert.match(text, /"plan": "\.\/plan\.json": a file in its folder holding \{ story: \{ title, description\?, text\? \}, capabilities: \[/, "and its own story's plan");
  assert.equal((tool as { name?: string }).name, "plugin_contract", "an agent reaches it as a tool");
  const { PLUGIN_FAMILIES } = await import("./factory/verbs.js");
  assert.deepEqual(PLUGIN_FAMILIES[0]!.verbs.map((each) => each.callerless), [true, true, true, undefined, undefined, undefined], "contract, new and check need no project; importing a plugin's plan, removing its records, or fencing its roles, needs its library");
});

test("5.8 a factory plugin mounted in a switched-off part's place declares its own kinds of record, named <plugin>.<kind> in its manifest's recordKinds, which the library then reads; with its part on it declares none, and a kind outside its name or of a shape the library cannot read is left out, said with why", (t) => {
  const note = {
    kind: "voice.note",
    version: 1,
    writers: ["storytree_voice"],
    fields: { type: "object", properties: { text: { type: "string", minLength: 1 } }, required: ["text"], additionalProperties: false },
  };
  const declaring = (kinds: unknown) => ({ manifest: { interface: PLUGIN_INTERFACE, recordKinds: kinds } });
  const folder = factory(t, {
    voice: declaring([note]),
    stray: declaring([{ ...note, kind: "voice.memo" }]),
    misshapen: declaring([{ ...note, kind: "misshapen.note", fields: { type: "string" } }]),
    unwritten: declaring([{ ...note, kind: "unwritten.note", writers: [] }]),
  });
  const voice = { folder, plugins: { "ci-health": "voice" } };
  const declared = recordKinds(builtIn.graph, voice, ["ci-health"]);
  assert.deepEqual(declared, { kinds: [note], failed: {} });
  assert.deepEqual(recordKinds(builtIn.graph, voice, []), { kinds: [], failed: {} }, "switched back on, the plugin declares nothing");
  const outside = { folder, plugins: { voice: "voice" } };
  assert.equal(Object.hasOwn(builtIn.graph, "voice"), false);
  assert.deepEqual(recordKinds(builtIn.graph, outside, ["voice"]), { kinds: [note], failed: {} }, "a part this host's graph lacks, named off, still gives its stand-in's kinds");
  assert.deepEqual(recordKinds(builtIn.graph, outside, []), { kinds: [], failed: {} }, "and with it on, none");

  assert.equal(pluginSchema(declared.kinds).versions["voice.note"], 1, "the library reads what it declared");

  for (const [plugin, why] of [
    ["stray", /stray's record kind "voice\.memo" is not named stray\.<kind>/],
    ["misshapen", /"misshapen\.note"'s fields must be a JSON Schema of type "object"/],
    ["unwritten", /"unwritten\.note" names no writers/],
  ] as const) {
    const result = recordKinds(builtIn.graph, { folder, plugins: { "ci-health": plugin } }, ["ci-health"]);
    assert.deepEqual(result.kinds, []);
    assert.match(result.failed["ci-health"] ?? "", why);
    assert.match(checkPlugin(folder, plugin).problems.join("\n"), why, "plugin check says so too");
  }
  assert.deepEqual(checkPlugin(folder, "voice"), { loads: true, adds: { recordKinds: 1 }, problems: [] });
});

test("5.9 `plugin remove-records <plugin>` refuses a plugin switched on, removing nothing; switching it off removes none of its records; then it lists every record it would remove, by kind with how many and their ids, removing nothing, and with --yes removes exactly what it listed", async (t) => {
  const { act, tool, home } = await pluginVerb(t, "remove-records");
  const { setPartOff } = await import("@storytree/project-and-caller");
  // The project's library, as far as this verb reaches it: the records of each plugin's kinds, and what was removed.
  const records = new Map([["voice.note_1", "voice.note"], ["voice.note_2", "voice.note"], ["voice.tag_1", "voice.tag"]]);
  const removed: { listed: PluginRecords; reason: string }[] = [];
  const pluginRecords = async (plugin: string): Promise<PluginRecords> => {
    const kinds = new Map<string, string[]>();
    for (const [id, kind] of [...records].sort()) if (kind.startsWith(`${plugin}.`)) kinds.set(kind, [...(kinds.get(kind) ?? []), id]);
    return { plugin, kinds: [...kinds].map(([kind, ids]) => ({ kind, count: ids.length, ids })) };
  };
  const library = {
    pluginRecords,
    async removePluginRecords(listed: PluginRecords, reason: string) {
      removed.push({ listed, reason });
      for (const { ids } of listed.kinds) for (const id of ids) records.delete(id);
      return listed;
    },
  };
  const all = await pluginRecords("voice");

  setPartOff("ci-health", true, home, "voice");
  const refusal = await act({ plugin: "voice", yes: true }, { library }).then(() => undefined, (error: Error & { next?: readonly { command?: string }[] }) => error);
  assert.match(refusal?.message ?? "", /voice is switched on: it stands in for ci-health/);
  assert.deepEqual(refusal?.next?.map(({ command }) => command), ["settings set part ci-health on"]);
  assert.deepEqual(removed, [], "nothing is removed while it is switched on");

  setPartOff("ci-health", false, home);
  assert.deepEqual(await pluginRecords("voice"), all, "switching it off removes none of its records");

  const listing = await act({ plugin: "voice", yes: false }, { library });
  assert.match(listing.text, /voice's records in this project, none removed yet:\n  voice\.note \(2\): voice\.note_1, voice\.note_2\n  voice\.tag \(1\): voice\.tag_1/);
  assert.deepEqual(removed, [], "listing removes nothing");
  assert.deepEqual(listing.next?.map(({ command }) => command), ["plugin remove-records voice --yes"]);

  const done = await act({ plugin: "voice", yes: true }, { library, writer: { actor: "session:remove" } });
  assert.match(done.text, /Removed voice's records from this project:\n  voice\.note \(2\): voice\.note_1, voice\.note_2\n  voice\.tag \(1\): voice\.tag_1/);
  assert.deepEqual(removed.map(({ listed }) => listed), [all], "it removes exactly what it listed");
  assert.match((await act({ plugin: "voice", yes: true }, { library })).text, /voice has no records in this project/);
  assert.equal((tool as { name?: string }).name, "remove_plugin_records", "an agent reaches it as a tool");
});

test("5.12 · a plugin's manifest declares its long-running services, each { name, from, export, run } with run \"always\" or { every: \"<n>m\" } and the export { start(host) }: `plugin check` loads one declaring only services, saying how many, and refuses a malformed one with why", async (t) => {
  const services = (entries: unknown, module = "export const listen = { async start(host) { await new Promise((ended) => host.stopping.addEventListener(\"abort\", ended)); host.log(`stopped in ${host.folder}`); } };\nexport const commit = { start() {} };\n") => ({
    exports: { "./services": "./services.js" },
    manifest: { interface: PLUGIN_INTERFACE, services: entries },
    files: { "services.js": module },
  });
  const listen = { name: "listen", from: "./services", export: "listen", run: "always" };
  const commit = { name: "commit", from: "./services", export: "commit", run: { every: "15m" } };
  const folder = factory(t, {
    voice: services([listen, commit]),
    unnamed: services([{ ...listen, name: "" }]),
    hourly: services([{ ...listen, run: "hourly" }]),
    "no-unit": services([{ ...commit, run: { every: "15" } }]),
    twice: services([listen, { ...commit, name: "listen" }]),
    "no-start": services([listen], "export const listen = { run() {} };\n"),
    unexported: services([{ ...listen, from: "./listen" }]),
    "no-list": services(listen),
  });
  assert.deepEqual(checkPlugin(folder, "voice"), { loads: true, adds: { services: 2 }, problems: [] }, "a plugin declaring only services is a plugin");
  const declared = pluginServices(folder, "voice");
  assert.deepEqual(declared.map(({ name, run }) => ({ name, run })), [{ name: "listen", run: "always" }, { name: "commit", run: { every: "15m" } }]);
  const stopping = new AbortController();
  const said: string[] = [];
  const host: ServiceHost = { folder: path.join(folder, "plugins", "voice"), settings: {} as ServiceHost["settings"], log: (line) => said.push(line), stopping: stopping.signal };
  const running = declared[0]!.start(host);
  stopping.abort();
  await running;
  assert.deepEqual(said, [`stopped in ${host.folder}`], "the declared start runs, handed the host, until its stop signal fires");

  for (const [plugin, why] of [
    ["unnamed", /unnamed's service 1 has no name/],
    ["hourly", /hourly's service listen runs "hourly", not "always" or \{ every: "<n>m" \}/],
    ["no-unit", /no-unit's service commit runs \{"every":"15"\}, not "always" or \{ every: "<n>m" \}/],
    ["twice", /twice declares the service listen twice/],
    ["no-start", /no-start's service listen: services\.js exports no \{ start\(host\) \} called listen/],
    ["unexported", /unexported's service listen names "\.\/listen", which it does not export/],
    ["no-list", /no-list's storytree manifest names services with no list/],
  ] as const) {
    const checked = checkPlugin(folder, plugin);
    assert.equal(checked.loads, false, plugin);
    assert.match(checked.problems.join("\n"), why);
  }
});

test("5.15 · `plugin check` on a plugin made `--for <part>` lists what that part provides that the plugin does not: its commands and tools, as the host's door composes them", async (t) => {
  const { act: create, home } = await pluginVerb(t, "new");
  await create({ plugin: "my-health", for: "ci-health" });
  await create({ plugin: "my-extra" });
  const { PLUGIN_FAMILIES } = await import("./factory/verbs.js");
  const check = PLUGIN_FAMILIES[0]!.verbs.find((each) => "name" in each.command && each.command.name === "check")!;
  const act = (input: object, context: object) => check.act(input as never, { folder: home, ...context } as never, { door: "command", say: (step) => step.command! });
  const hostVerbs = async () => ({
    parts: [
      { name: "health", verbs: [{ command: { family: "health", name: "worklist" }, tool: { name: "health_worklist" } }, { command: { family: "health", name: "ci" }, tool: { absent: "a terminal step" } }] },
      { name: "globe", verbs: [] },
    ],
    owners: ["ci-health", "forest"],
    graph: builtIn.graph,
  });
  const checked = (await act({ plugin: "my-health" }, { hostVerbs })).text;
  assert.match(checked, /my-health would load/);
  assert.match(checked, /^my-health stands in for ci-health, which provides what my-health does not: the commands health worklist, health ci; and the tool health_worklist\.$/m);
  assert.doesNotMatch((await act({ plugin: "my-extra" }, { hostVerbs })).text, /provides what/, "a plugin standing in for no part lacks nothing");
  assert.match((await act({ plugin: "my-extra", for: "ci-health" }, { hostVerbs })).text, /^my-extra stands in for ci-health, which provides what my-extra does not: the commands health worklist, health ci/m, "--for names the part for a plugin made without one");
});

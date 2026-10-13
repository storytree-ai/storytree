/**
 * Capability 12 · Import an existing project: one test per contract 12.1-12.4 in the app setup story (ADR-0993 D1, D2, D6).
 *
 * The storytree project and the imported folders are throwaway directories. The project is set up on the
 * real Postgres `pnpm test` provides, named with uniqueProjectName(), and its database is dropped
 * afterwards, pass or fail.
 */
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { importsOf, machineOf, recordImport } from "@storytree/session-management";
import { git, withTempDir } from "@storytree/session-management/testing/folders";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/session-management/testing/pg";
import { connect, type Library, type SchemaRecord, type Storytree } from "@storytree/library";

import { importProject } from "./importing.js";
import { setUpProject } from "./making.js";

interface World {
  readonly dir: string;
  readonly home: string;
  /** The storytree project's own folder. */
  readonly trunk: string;
  readonly storytree: Storytree;
  readonly library: Library;
}

/** Run `body` with a storytree project set up in a throwaway folder; afterwards drop it. */
async function withProject(body: (world: World) => Promise<void>): Promise<void> {
  const project = uniqueProjectName();
  await withTempDir(async (dir) => {
    const home = path.join(dir, "home");
    const trunk = path.join(dir, "storytree-project");
    mkdirSync(trunk);
    const storytree = await connect({ url: testServerUrl() });
    try {
      await setUpProject({ folder: trunk, project, storytree, storytreeHome: home });
      const library = await storytree.openProject(project);
      try {
        await body({ dir, home, trunk, storytree, library });
      } finally {
        await library.close();
      }
    } finally {
      try {
        await storytree.close();
      } finally {
        await dropTestProjects([project]);
      }
    }
  });
}

/** Write `files` (path relative to `root`, content) under `root`. */
function write(root: string, files: Record<string, unknown>): void {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), typeof content === "string" ? content : JSON.stringify(content));
  }
}

/** Every file and folder under `root` with its size and modification time: what "nothing was written" compares. */
function snapshot(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: "utf8" }).sort().map((entry) => {
    const stat = statSync(path.join(root, entry));
    return `${entry} ${stat.size} ${stat.mtimeMs}`;
  });
}

/** The project's mapped stories, by package. */
async function mapped(library: Library): Promise<Record<string, SchemaRecord<"story">["fields"]>> {
  const stories = await library.list("story");
  return Object.fromEntries(stories.flatMap((story) => (story.fields.mapped === undefined ? [] : [[story.fields.mapped.package, story.fields]])));
}

test("12.1 importing a folder records it beside the trunk, with its repository and commit, and maps one story per declared package, named as the package names itself, with no capabilities; nothing is written into the folder", async () => {
  await withProject(async ({ dir, home, storytree, library }) => {
    const shop = path.join(dir, "shop");
    write(shop, {
      "package.json": { name: "shop", private: true, workspaces: ["packages/*", "apps/web"] },
      "packages/cart/package.json": { name: "@shop/cart", description: "The basket" },
      "packages/pay/package.json": { name: "@shop/pay" },
      "packages/notes/README.md": "not a package",
      "apps/web/package.json": { name: "@shop/web" },
    });
    git(shop, "init", "-q");
    git(shop, "add", ".");
    git(shop, "commit", "-qm", "shop");
    git(shop, "remote", "add", "origin", "https://github.com/shop/shop.git");
    const commit = git(shop, "rev-parse", "HEAD").trim();
    const before = snapshot(shop);

    const imported = await importProject({ folder: shop, library, storytree, storytreeHome: home });
    assert.deepEqual(imported.added.map((story) => story.title), ["@shop/web", "@shop/cart", "@shop/pay"]);
    assert.deepEqual(await mapped(library), {
      "apps/web": { title: "@shop/web", mapped: { from: "https://github.com/shop/shop.git", package: "apps/web", folders: ["apps/web"] } },
      "packages/cart": { title: "@shop/cart", description: "The basket", mapped: { from: "https://github.com/shop/shop.git", package: "packages/cart", folders: ["packages/cart"] } },
      "packages/pay": { title: "@shop/pay", mapped: { from: "https://github.com/shop/shop.git", package: "packages/pay", folders: ["packages/pay"] } },
    });
    assert.deepEqual((await library.list("capability")).filter((capability) => imported.added.some((story) => story.id === capability.fields.story)), [], "a mapped story has no capabilities");
    const machine = machineOf(home);
    assert.deepEqual(await importsOf(storytree, library.name, machine.id), [
      { project: library.name, machine: machine.id, machineName: machine.name, folder: shop, repository: "https://github.com/shop/shop.git", commit, approvedBy: "import" },
    ]);
    assert.deepEqual(snapshot(shop), before, "nothing was written into the imported folder");

    // A project that is one package, with no git: one story, keyed by its folder; a pnpm workspace is read too.
    const tool = path.join(dir, "tool");
    write(tool, { "package.json": { name: "tool", description: "A tool" } });
    await importProject({ folder: tool, library, storytree, storytreeHome: home });
    assert.deepEqual(Object.values(await mapped(library)).filter((fields) => fields.mapped?.from === tool), [{ title: "tool", description: "A tool", mapped: { from: tool, package: ".", folders: ["."] } }]);
    const mono = path.join(dir, "mono");
    write(mono, { "package.json": { name: "mono" }, "pnpm-workspace.yaml": "packages:\n  - 'libs/**'\n  - \"!libs/skip\"\n", "libs/a/package.json": {}, "libs/b/c/package.json": { name: "c" }, "libs/skip/package.json": { name: "skip" } });
    await importProject({ folder: mono, library, storytree, storytreeHome: home });
    assert.deepEqual(Object.values(await mapped(library)).filter((fields) => fields.mapped?.from === mono).map((fields) => fields.title).sort(), ["a", "c"], "a nameless package is named by its folder; a negated glob is left out");
  });
});

test("12.2 importing again adds the packages that are new, retires the stories whose package is gone, and leaves every other mapped story as it stands", async () => {
  await withProject(async ({ dir, home, storytree, library }) => {
    const shop = path.join(dir, "shop");
    write(shop, { "package.json": { workspaces: { packages: ["packages/*"] } }, "packages/cart/package.json": { name: "cart" }, "packages/pay/package.json": { name: "pay" } });
    const first = await importProject({ folder: shop, library, storytree, storytreeHome: home });
    const [cart, pay] = first.added;
    await library.editStory(cart!.id, { description: "an agent's note" });

    rmSync(path.join(shop, "packages/pay"), { recursive: true });
    write(shop, { "packages/ship/package.json": { name: "ship" }, "packages/cart/package.json": { name: "cart renamed" } });
    const again = await importProject({ folder: shop, library, storytree, storytreeHome: home });
    assert.deepEqual(again.added.map((story) => story.title), ["ship"]);
    assert.deepEqual(again.retired, [pay!.id]);
    assert.deepEqual(again.kept, [cart!.id]);
    assert.deepEqual((await library.get(cart!.id))?.fields, { title: "cart", description: "an agent's note", mapped: { from: shop, package: "packages/cart", folders: ["packages/cart"] } }, "a kept story stands as it is");
    assert.equal(await library.get(pay!.id), null);
    assert.equal((await importsOf(storytree, library.name, machineOf(home).id)).length, 1, "the folder is recorded once");
  });
});

test("12.3 a folder that does not exist, one inside the storytree project, and one with no package.json are refused, saying why, and nothing is written", async () => {
  await withProject(async ({ dir, home, trunk, storytree, library }) => {
    const inside = path.join(trunk, "vendor", "lib");
    write(inside, { "package.json": { name: "lib" } });
    const plain = path.join(dir, "plain");
    write(plain, { "index.js": "" });
    const refusals: [string, RegExp][] = [
      [path.join(dir, "missing"), /does not exist/],
      [inside, /inside storytree project/],
      [trunk, /inside storytree project/],
      [plain, /no package\.json/],
    ];
    const before = await library.history();
    for (const [folder, why] of refusals) {
      await assert.rejects(importProject({ folder, library, storytree, storytreeHome: home }), (error: unknown) => error instanceof Error && error.name === "ImportRefusedError" && why.test(error.message), folder);
    }
    assert.deepEqual(await library.history(), before, "no story was written");
    assert.deepEqual(await importsOf(storytree, library.name, machineOf(home).id), [], "no import was recorded");
    assert.equal(readFileSync(path.join(inside, "package.json"), "utf8"), JSON.stringify({ name: "lib" }));
  });
});

test("12.4 importing again says the commit recorded before and now and the files added, changed and removed between them, and names each explored capability whose covered files are gone, leaving it as it stands", async () => {
  await withProject(async ({ dir, home, storytree, library }) => {
    const shop = path.join(dir, "shop");
    write(shop, { "package.json": { name: "shop" }, "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n", "src/ui/menu.ts": "export const menu = 1;\n" });
    git(shop, "init", "-q");
    git(shop, "add", ".");
    git(shop, "commit", "-qm", "one");
    git(shop, "remote", "add", "origin", "https://github.com/shop/shop.git");
    const one = git(shop, "rev-parse", "HEAD").trim();
    const first = await importProject({ folder: shop, library, storytree, storytreeHome: home });
    assert.equal(first.before, undefined, "a first import has nothing before it");
    assert.equal(first.changes, undefined);
    assert.deepEqual(first.stranded, []);
    const [story] = first.added;
    const menu = await library.addCapability({ title: "Menu", story: story!.id, covers: ["src/ui"] });
    const bee = await library.addCapability({ title: "Bee", story: story!.id, covers: ["src/b.ts", "src/a.ts"] });

    const same = await importProject({ folder: shop, library, storytree, storytreeHome: home });
    assert.deepEqual(same.before, { commit: one });
    assert.equal(same.commit, one);
    assert.deepEqual(same.changes, { added: [], changed: [], removed: [] }, "the commit did not move");

    write(shop, { "src/a.ts": "export const a = 2;\n", "src/c.ts": "export const c = 1;\n" });
    rmSync(path.join(shop, "src/b.ts"));
    rmSync(path.join(shop, "src/ui"), { recursive: true });
    git(shop, "add", "-A");
    git(shop, "commit", "-qm", "two");
    const two = git(shop, "rev-parse", "HEAD").trim();
    const again = await importProject({ folder: shop, library, storytree, storytreeHome: home });
    assert.deepEqual(again.before, { commit: one });
    assert.equal(again.commit, two);
    assert.deepEqual(again.changes, { added: ["src/c.ts"], changed: ["src/a.ts"], removed: ["src/b.ts", "src/ui/menu.ts"] });
    assert.deepEqual(again.stranded, [
      { id: menu.id, title: menu.fields.title, story: story!.id, gone: ["src/ui"] },
      { id: bee.id, title: bee.fields.title, story: story!.id, gone: ["src/b.ts"] },
    ].sort((x, y) => x.id.localeCompare(y.id)));
    assert.deepEqual((await library.get(bee.id))?.fields.covers, ["src/b.ts", "src/a.ts"], "the re-import reshapes no capability an agent drew");
    assert.notEqual(await library.get(menu.id), null);

    // A recorded commit git no longer knows: the commits are still said, the files are not.
    await recordImport(storytree, { project: library.name, machine: machineOf(home).id, machineName: machineOf(home).name, folder: shop, repository: "https://github.com/shop/shop.git", commit: "0".repeat(40) });
    const unknown = await importProject({ folder: shop, library, storytree, storytreeHome: home });
    assert.deepEqual(unknown.before, { commit: "0".repeat(40) });
    assert.equal(unknown.changes, undefined);
  });
});

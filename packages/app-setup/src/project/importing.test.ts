/**
 * Capability 12 · Import an existing project: one test per contract 12.1-12.5 in the app setup story (ADR-0993 D1, D2, D6).
 *
 * The storytree project and the imported folders are throwaway directories. The project is set up on the
 * real Postgres `pnpm test` provides, named with uniqueProjectName(), and its database is dropped
 * afterwards, pass or fail.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { importsOf, machineOf, recordImport } from "@storytree/project-and-caller";
import { git, withTempDir } from "@storytree/project-and-caller/testing/folders";
import { dropTestProjects, testServerUrl, uniqueProjectName } from "@storytree/project-and-caller/testing/pg";
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

/** The project's imported stories, by package. */
async function mapped(library: Library): Promise<Record<string, SchemaRecord<"story">["fields"]>> {
  const stories = await library.list("story");
  return Object.fromEntries(stories.flatMap((story) => (story.fields.mapped === undefined ? [] : [[story.fields.mapped.package, story.fields]])));
}

test("12.1 importing a folder records it beside the trunk, with its repository and commit, and maps one story per declared package, named as the package names itself, each with the capabilities and links drawn from its code, titled by their paths; a story whose code the survey cannot read gets none; nothing is written into the folder", async () => {
  await withProject(async ({ dir, home, storytree, library }) => {
    const shop = path.join(dir, "shop");
    write(shop, {
      "package.json": { name: "shop", private: true, workspaces: ["packages/*", "apps/web"] },
      "packages/cart/package.json": { name: "@shop/cart", description: "The basket" },
      "packages/cart/src/index.ts": "import { sum } from \"./money/sum.js\";\nexport const total = sum;\n",
      "packages/cart/src/money/sum.ts": "export const sum = 1;\n",
      "packages/cart/src/money/sum.test.ts": "import { sum } from \"./sum.js\";\n",
      "packages/pay/package.json": { name: "@shop/pay" },
      "packages/pay/main.go": "package main\n",
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
    const cart = imported.added.find((story) => story.title === "@shop/cart")!;
    const drawn = (await library.list("capability")).filter((capability) => capability.fields.story === cart.id).sort((a, b) => a.fields.title.localeCompare(b.fields.title));
    assert.deepEqual(drawn.map(({ fields }) => ({ title: fields.title, covers: fields.covers, proposed: fields.proposed })), [
      { title: "1 · src/index.ts", covers: ["packages/cart/src/index.ts"], proposed: false },
      { title: "2 · src/money", covers: ["packages/cart/src/money"], proposed: false },
    ], "an imported story's code is drawn as capabilities titled by their paths; its tests are none");
    const ids = new Map(drawn.map((capability) => [capability.id, capability.fields.title] as const));
    assert.deepEqual((await library.list("edge")).filter((edge) => ids.has(edge.fields.from)).map((edge) => [ids.get(edge.fields.from), ids.get(edge.fields.to)]), [["1 · src/index.ts", "2 · src/money"]], "its links are exactly its imports");
    assert.deepEqual(imported.added.map((story) => [story.title, story.capabilities]), [["@shop/web", 0], ["@shop/cart", 2], ["@shop/pay", 0]], "a story with no code, or code the survey cannot read, gets none");
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

test("12.2 importing again adds the packages that are new, retires the stories whose package is gone, and leaves every other imported story as it stands", async () => {
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

test("12.3 a folder that does not exist, one nested inside the storytree project, and one with no package.json, pyproject.toml, setup.cfg or setup.py are refused, saying why, and nothing is written; the project's own trunk folder is mapped in place, leaving out the packages of the stories built there", async () => {
  await withProject(async ({ dir, home, trunk, storytree, library }) => {
    const inside = path.join(trunk, "vendor", "lib");
    write(inside, { "package.json": { name: "lib" } });
    const plain = path.join(dir, "plain");
    write(plain, { "index.js": "" });
    const refusals: [string, RegExp][] = [
      [path.join(dir, "missing"), /does not exist/],
      [inside, /inside storytree project/],
      [plain, /no package\.json, pyproject\.toml, setup\.cfg or setup\.py/],
    ];
    const before = await library.history();
    for (const [folder, why] of refusals) {
      await assert.rejects(importProject({ folder, library, storytree, storytreeHome: home }), (error: unknown) => error instanceof Error && error.name === "ImportRefusedError" && why.test(error.message), folder);
    }
    assert.deepEqual(await library.history(), before, "no story was written");
    assert.deepEqual(await importsOf(storytree, library.name, machineOf(home).id), [], "no import was recorded");
    assert.equal(readFileSync(path.join(inside, "package.json"), "utf8"), JSON.stringify({ name: "lib" }));

    // The trunk folder, an existing repository set up in place (ADR-1213 D1): its packages are mapped where they are,
    // but a package of a story storytree built there is never mapped (ADR-0993 D2).
    write(trunk, { "package.json": { name: "repo", workspaces: ["packages/*"] }, "packages/cart/package.json": { name: "@repo/cart" }, "packages/basket/package.json": { name: "@repo/basket" } });
    await library.addStory({ title: "Basket" });
    const imported = await importProject({ folder: trunk, library, storytree, storytreeHome: home });
    assert.deepEqual(imported.added.map((story) => story.title), ["@repo/cart"]);
    assert.deepEqual(Object.keys(await mapped(library)), ["packages/cart"]);
  });
});

test("12.7 · the refusal of a folder with no package to import names the languages the map reads, and, when the folder holds code in others, names those and what still works", async () => {
  await withProject(async ({ dir, home, storytree, library }) => {
    const go = path.join(dir, "go-service");
    write(go, { "cmd/main.go": "package main", "db/schema.sql": "" });
    const empty = path.join(dir, "notes");
    write(empty, { "README.md": "" });
    const refusal = async (folder: string) => {
      const error = await importProject({ folder, library, storytree, storytreeHome: home }).then(() => undefined, (thrown: unknown) => thrown as Error);
      assert.equal(error?.name, "ImportRefusedError", folder);
      return error!.message;
    };
    const fromGo = await refusal(go);
    assert.match(fromGo, /no JavaScript, TypeScript or Python package to import/);
    assert.match(fromGo, /Its code is in Go and SQL, which storytree's map cannot read/);
    assert.match(fromGo, /planning its stories by hand still works/);
    const fromEmpty = await refusal(empty);
    assert.match(fromEmpty, /no JavaScript, TypeScript or Python package to import/);
    assert.doesNotMatch(fromEmpty, /cannot read/);
  });
});

test("12.4 importing again says the commit recorded before and now and the files added, changed and removed between them, and redraws each imported story whose code it reads by the rule, naming each capability added and retired", async () => {
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
    assert.deepEqual(first.redrawn, [], "a first import draws, it does not redraw");
    const [story] = first.added;
    const drawn = (await library.list("capability")).filter((capability) => capability.fields.story === story!.id);
    const menu = drawn.find((capability) => capability.fields.covers?.includes("src/ui"))!;
    const bee = drawn.find((capability) => capability.fields.covers?.includes("src/b.ts"))!;

    const same = await importProject({ folder: shop, library, storytree, storytreeHome: home });
    assert.deepEqual(same.before, { commit: one });
    assert.equal(same.commit, one);
    assert.deepEqual(same.changes, { added: [], changed: [], removed: [] }, "the commit did not move");
    assert.deepEqual(same.redrawn, [], "code that did not move redraws nothing");

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
    const added = (await library.list("capability")).find((capability) => capability.fields.story === story!.id && capability.fields.covers?.includes("src/c.ts"))!;
    assert.equal(added.fields.proposed, false, "a capability the redraw adds is built: its code is there");
    assert.deepEqual(again.redrawn, [{
      story: { id: story!.id, title: "shop" },
      merged: [],
      split: [],
      added: [{ id: added.id, title: added.fields.title }],
      retired: [{ id: bee.id, title: bee.fields.title }, { id: menu.id, title: menu.fields.title }].sort((x, y) => x.id.localeCompare(y.id)),
      left: [],
    }]);
    assert.equal(await library.get(bee.id), null, "a capability whose code is gone retires");
    assert.equal(await library.get(menu.id), null);
    assert.deepEqual((await library.list("capability")).filter((capability) => capability.fields.story === story!.id).map(({ fields }) => fields.covers).sort(), [["src/a.ts"], ["src/c.ts"]], "the story is drawn as its code now stands");

    // A recorded commit git no longer knows: the commits are still said, the files are not.
    await recordImport(storytree, { project: library.name, machine: machineOf(home).id, machineName: machineOf(home).name, folder: shop, repository: "https://github.com/shop/shop.git", commit: "0".repeat(40) });
    const unknown = await importProject({ folder: shop, library, storytree, storytreeHome: home });
    assert.deepEqual(unknown.before, { commit: "0".repeat(40) });
    assert.equal(unknown.changes, undefined);
  });
});

test("12.10 a redraw keeps what was written: an unchanged capability keeps its id, title, description and contracts; a new one inherits the id, title and description of the one it takes the most files from; every contract moves to the capability now holding most of its old one's files, keeping its title; a capability left covering nothing retires; a story drawn by hand is redrawn alike", async () => {
  await withProject(async ({ dir, home, storytree, library }) => {
    const shop = path.join(dir, "shop");
    write(shop, {
      "package.json": { name: "shop" },
      "src/index.ts": "import { sum } from \"./money/sum.js\";\nimport { vat } from \"./tax/vat.js\";\nexport const total = sum + vat;\n",
      "src/log.ts": "export const log = 1;\n",
      "src/money/sum.ts": "export const sum = 1;\n",
      "src/money/rate.ts": "export const rate = 1;\n",
      "src/tax/vat.ts": "export const vat = 1;\n",
      "src/tax/gst.ts": "export const gst = 1;\n",
    });
    const [story] = (await importProject({ folder: shop, library, storytree, storytreeHome: home })).added;
    const ofStory = async () => (await library.list("capability")).filter((capability) => capability.fields.story === story!.id);
    const covering = async (cover: string) => (await ofStory()).find((capability) => capability.fields.covers?.includes(cover))!;
    const index = await covering("src/index.ts");
    const log = await covering("src/log.ts");
    const money = await covering("src/money");
    const tax = await covering("src/tax");
    const number = (capability: SchemaRecord<"capability">) => capability.fields.title.split(" · ")[0];
    // What an agent wrote: names, descriptions and contracts.
    await library.editCapability(log.id, { title: `${number(log)} · Logging`, description: "Writes the log" });
    await library.editCapability(money.id, { title: `${number(money)} · Money`, description: "Adds money up" });
    const onIndex = await library.addContract({ capability: index.id, title: "Totals the basket" });
    const onMoney = await library.addContract({ capability: money.id, title: "Sums" });
    const onTax = await library.addContract({ capability: tax.id, title: "Charges tax" });
    // A contract on a drawn edge, one on an edge the code never made, and another story's link to the index.
    const indexToMoney = (await library.list("edge")).find((edge) => edge.fields.from === index.id && edge.fields.to === money.id)!;
    const onIndexEdge = await library.addContract({ edge: indexToMoney.id, title: "Hands the sum over" });
    const handDrawn = await library.addEdge({ from: tax.id, to: money.id });
    const onHandEdge = await library.addContract({ edge: handDrawn.id, title: "Converts" });
    const elsewhere = await library.addStory({ title: "Elsewhere" });
    const user = await library.addCapability({ story: elsewhere.id, title: "Uses the index", dependsOn: [index.id] });

    // The money folder splits (two files into fx/, two new beside it); the tax folder imports the index, closing a loop.
    rmSync(path.join(shop, "src/money"), { recursive: true });
    write(shop, {
      "src/money/sum.ts": "export const sum = 1;\n",
      "src/money/round.ts": "export const round = 1;\n",
      "src/money/fx/rate.ts": "export const rate = 1;\n",
      "src/money/fx/table.ts": "export const table = 1;\n",
      "src/tax/vat.ts": "import { log } from \"../log.js\";\nimport { total } from \"../index.js\";\nexport const vat = log + total;\n",
    });
    const again = await importProject({ folder: shop, library, storytree, storytreeHome: home });

    const now = await ofStory();
    const byId = new Map(now.map((capability) => [capability.id, capability] as const));
    assert.deepEqual(byId.get(log.id)?.fields, { ...log.fields, title: `${number(log)} · Logging`, description: "Writes the log" }, "an unchanged capability stands as it was");
    assert.deepEqual(pick(byId.get(money.id)), { title: `${number(money)} · Money`, description: "Adds money up", covers: ["src/money/fx"] }, "the part taking most of the money folder's files inherits it, its name kept");
    assert.deepEqual(pick(byId.get(tax.id)), { title: `${number(tax)} · src/index.ts + src/tax`, covers: ["src/index.ts", "src/tax"] }, "the loop inherits the tax folder, which gave it most files; a title no one named reads the new paths");
    assert.equal(byId.has(index.id), false, "the index, merged into the loop, retires");
    const added = now.filter((capability) => ![log.id, money.id, tax.id].includes(capability.id));
    assert.deepEqual(added.map(({ fields }) => [fields.covers, fields.proposed]).sort(), [[["src/money/round.ts"], false], [["src/money/sum.ts"], false]]);
    const contracts = new Map((await library.list("contract")).map((contract) => [contract.id, contract.fields] as const));
    assert.deepEqual([onIndex, onMoney, onTax].map((contract) => contracts.get(contract.id)), [
      { ...onIndex.fields, capability: tax.id },
      onMoney.fields,
      onTax.fields,
    ], "no contract is dropped: the index's moves to the loop holding its file, keeping its number");
    for (const contract of [onIndexEdge, onHandEdge]) {
      assert.deepEqual(contracts.get(contract.id), { title: contract.fields.title, capability: tax.id }, "an edge's contract moves, keeping its title, to the capability holding its dependent's files");
    }
    assert.deepEqual(((await library.get(user.id)) as SchemaRecord<"capability"> | null)?.fields.dependsOn, [tax.id], "another story's link to a retired capability goes to the one holding its files");
    const named = (capability: SchemaRecord<"capability">) => ({ id: capability.id, title: byId.get(capability.id)?.fields.title ?? capability.fields.title });
    const sorted = <T extends { id: string }>(list: T[]) => list.sort((x, y) => x.id.localeCompare(y.id));
    assert.deepEqual(again.redrawn, [{
      story: { id: story!.id, title: "shop" },
      merged: [{ into: named(tax), from: sorted([named(index), named(tax)]) }],
      split: [{ from: named(money), into: sorted([named(money), ...added.map(named)]) }],
      added: sorted(added.map(named)),
      retired: [{ ...named(index), contractsTo: named(tax) }],
      left: [],
    }]);
    const ids = new Map(now.map((capability) => [capability.id, capability.fields.covers!.join(" + ")] as const));
    assert.deepEqual((await library.list("edge")).filter((edge) => ids.has(edge.fields.from)).map((edge) => `${ids.get(edge.fields.from)} -> ${ids.get(edge.fields.to)}`).sort(), [
      "src/index.ts + src/tax -> src/log.ts",
      "src/index.ts + src/tax -> src/money/sum.ts",
    ], "the links are the imports as they stand");

    // A story imported before storytree drew, its capability drawn by hand over the whole of src, is redrawn alike.
    const old = path.join(dir, "old");
    write(old, { "package.json": { name: "old" }, "src/main.ts": "export const main = 1;\n", "src/util/a.ts": "export const a = 1;\n", "src/util/b.ts": "export const b = 1;\n" });
    const [drawnByHand] = (await library.mapStories(realpathSync(old), [{ package: ".", title: "old", folders: ["."] }])).added;
    const whole = await library.addCapability({ story: drawnByHand!.id, title: "Shop", description: "The whole shop", covers: ["src"], proposed: false });
    const onWhole = await library.addContract({ capability: whole.id, title: "Opens" });
    const lost = await library.addCapability({ story: drawnByHand!.id, title: "Lost", covers: ["lib"], proposed: false });
    const onLost = await library.addContract({ capability: lost.id, title: "Was there" });
    const redrawn = await importProject({ folder: old, library, storytree, storytreeHome: home });
    const parts = (await library.list("capability")).filter((capability) => capability.fields.story === drawnByHand!.id);
    assert.deepEqual(parts.map((capability) => [capability.id === whole.id, capability.fields.title, capability.fields.covers]).sort(), [
      [false, "2 · Lost", ["lib"]],
      [false, "3 · src/main.ts", ["src/main.ts"]],
      [true, "1 · Shop", ["src/util"]],
    ], "the part with most of its files keeps its id and name; the rest is added; one whose files are gone but holds a contract is left");
    assert.equal(((await library.get(onLost.id)) as SchemaRecord<"contract"> | null)?.fields.capability, lost.id, "no contract is dropped");
    assert.deepEqual(redrawn.redrawn.map(({ left }) => left), [[{ id: lost.id, title: "2 · Lost", gone: ["lib"] }]]);
    assert.equal(((await library.get(onWhole.id)) as SchemaRecord<"contract"> | null)?.fields.capability, whole.id);
    assert.deepEqual(redrawn.redrawn.map(({ split }) => split.map(({ from, into }) => [from.id, into.length])), [[[whole.id, 2]]]);
  });
});

/** A capability's title, description and covers, as a redraw keeps or changes them. */
function pick(capability: SchemaRecord<"capability"> | undefined): Record<string, unknown> {
  const { title, description, covers } = capability?.fields ?? {};
  return { title, ...(description === undefined ? {} : { description }), covers };
}

test("12.5 a workspace pattern that climbs out of the folder or runs past the matching limits is refused, saying why, and nothing is written; any '*' pattern is matched in time linear in the folder name", async () => {
  await withProject(async ({ dir, home, storytree, library }) => {
    // A name full of one letter against a pattern of many '*'s backtracks for minutes in a regular expression.
    const slow = path.join(dir, "slow");
    // Beside it, names whose pieces would only fit overlapping each other, or overlapping the last piece, match nothing.
    const workspaces = [`packages/${"*a".repeat(12)}*b`, "packages/x*ab*b", "packages/*cc*cc*"];
    const names = ["a".repeat(40), "xab", "xabab", "ccc", "cccc"];
    write(slow, { "package.json": { name: "slow", workspaces }, ...Object.fromEntries(names.map((name) => [`packages/${name}/package.json`, { name }])) });
    const child = `
      import { connect } from "@storytree/library";
      import { importProject } from ${JSON.stringify(import.meta.resolve("./importing.ts"))};
      const { url, project, folder, home } = JSON.parse(process.env.IMPORT_CASE);
      const storytree = await connect({ url });
      const library = await storytree.openProject(project);
      const imported = await importProject({ folder, library, storytree, storytreeHome: home });
      await library.close();
      await storytree.close();
      console.log(JSON.stringify(imported.added.map((story) => story.title)));
    `;
    // execFile kills the import and rejects once the bound passes.
    const run = await promisify(execFile)(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval", child], {
      cwd: import.meta.dirname,
      env: { ...process.env, IMPORT_CASE: JSON.stringify({ url: testServerUrl(), project: library.name, folder: slow, home }) },
      timeout: 30_000,
    });
    assert.deepEqual((JSON.parse(run.stdout.trim().split("\n").at(-1)!) as string[]).sort(), ["cccc", "xabab"], "each '*' pattern matches just the names it fits, inside the bound");

    const before = await library.history();
    const deep = Array.from({ length: 10_001 }, (_, at) => `packages/p${at}`);
    const refusals: [unknown[], RegExp, string[]?][] = [
      [["../outside/*"], /climbs out/],
      [["packages/../../*"], /climbs out/],
      [["**/**/**/**/*"], /more than 3 '\*\*'/],
      [["packages/*"], /more than 10000 folders/, deep],
    ];
    for (const [at, [workspaces, why, folders = []]] of refusals.entries()) {
      const folder = path.join(dir, `refused-${at}`);
      write(folder, { "package.json": { name: "refused", workspaces } });
      for (const sub of folders) mkdirSync(path.join(folder, sub), { recursive: true });
      await assert.rejects(importProject({ folder, library, storytree, storytreeHome: home }), (error: unknown) => error instanceof Error && error.name === "ImportRefusedError" && why.test(error.message), String(workspaces));
    }
    assert.deepEqual(await library.history(), before, "no story was written for a refused pattern");
    assert.deepEqual((await importsOf(storytree, library.name, machineOf(home).id)).map((imported) => imported.folder), [realpathSync.native(slow)], "no import was recorded for a refused pattern");
  });
});

test("12.6 a folder with pyproject.toml, setup.cfg or setup.py and no package.json imports as Python packages: a uv workspace's members less its exclude, its root too when it is a project, else the root and its Poetry path dependencies inside the folder, else one package, each named as its manifest names it", async () => {
  await withProject(async ({ dir, home, storytree, library }) => {
    const from = async (folder: string) => (await library.list("story")).map((story) => story.fields).filter((fields) => fields.mapped?.from === folder)
      .map((fields) => [fields.mapped!.package, fields.title, ...(fields.description === undefined ? [] : [fields.description])]).sort();

    const uv = path.join(dir, "uv");
    write(uv, {
      "pyproject.toml": "[project]\nname = \"shop\"\ndescription = \"The shop\"\n\n[tool.uv.workspace]\nmembers = [\"packages/*\", \"apps/web\"]\nexclude = [\"packages/scratch\"]\n",
      "packages/cart/pyproject.toml": "[project]\nname = \"cart\"\ndescription = 'The basket'\n",
      "packages/pay/pyproject.toml": "[project]\n# no name\nversion = \"1\"\n",
      "packages/scratch/pyproject.toml": "[project]\nname = \"scratch\"\n",
      "packages/notes/README.md": "not a package",
      "apps/web/pyproject.toml": "[project]\nname = \"web\"\n",
    });
    const before = snapshot(uv);
    await importProject({ folder: uv, library, storytree, storytreeHome: home });
    assert.deepEqual(await from(uv), [[".", "shop", "The shop"], ["apps/web", "web"], ["packages/cart", "cart", "The basket"], ["packages/pay", "pay"]], "members less exclude, the root a project too; a nameless member named by its folder");
    assert.deepEqual(snapshot(uv), before, "nothing was written into the imported folder");

    const virtual = path.join(dir, "virtual");
    write(virtual, { "pyproject.toml": "[tool.uv.workspace]\nmembers = [\"libs/*\"]\n", "libs/a/pyproject.toml": "[project]\nname = \"a\"\n" });
    await importProject({ folder: virtual, library, storytree, storytreeHome: home });
    assert.deepEqual(await from(virtual), [["libs/a", "a"]], "a workspace root that is no project is no package");

    const poetry = path.join(dir, "poetry");
    write(poetry, {
      "pyproject.toml": "[tool.poetry]\nname = \"app\"\ndescription = \"An app\"\n\n[tool.poetry.dependencies]\npython = \"^3.12\"\ncore = { path = \"libs/core\", develop = true }\noutside = { path = \"../elsewhere\" }\n\n[tool.poetry.group.dev.dependencies]\nkit = {path = \"libs/kit\"}\n",
      "libs/core/pyproject.toml": "[tool.poetry]\nname = \"core\"\n",
      "libs/kit/pyproject.toml": "[project]\nname = \"kit\"\n",
    });
    await importProject({ folder: poetry, library, storytree, storytreeHome: home });
    assert.deepEqual(await from(poetry), [[".", "app", "An app"], ["libs/core", "core"], ["libs/kit", "kit"]], "the root and its path dependencies inside the folder");

    const one = path.join(dir, "one");
    write(one, { "pyproject.toml": "[project]\nname = \"one\"\n" });
    const legacy = path.join(dir, "legacy");
    write(legacy, { "setup.cfg": "[metadata]\nname = legacy-tool\ndescription = Old style\n" });
    const script = path.join(dir, "script");
    write(script, { "setup.py": "from setuptools import setup\nsetup()\n" });
    for (const folder of [one, legacy, script]) await importProject({ folder, library, storytree, storytreeHome: home });
    assert.deepEqual([await from(one), await from(legacy), await from(script)], [[[".", "one"]], [[".", "legacy-tool", "Old style"]], [[".", "script"]]], "one package, named by its manifest, else by its folder");
  });
});

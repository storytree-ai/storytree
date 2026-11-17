// Capability 16 · The command schema: the shapes a story declares its verbs with, which every story downstream imports
// from the library and each front door reads (ADR-1035 D1).
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "../api/index.js";
import { consumersOf, judgedByLines, mounted, verb, VerbRefusal, whereOf, writtenLibrary, type VerbFamily, type VerbPlace } from "./verb.js";

test("16.1 · a verb is declared once with a face on each door or why a door lacks one, and its refusal is a misuse only when it says so, carrying the steps that do the job instead", async () => {
  const look = verb({
    command: { family: "garden", name: "look", summary: "look at the garden" },
    tool: { absent: "an agent reads the plan instead" },
    inputs: { bed: { kind: "text", word: 0, describe: "which bed" } },
    callerless: true,
    async act({ bed }, context: VerbPlace) {
      if (bed === "pond") throw new VerbRefusal("a pond is no bed", { next: [{ tool: "show_garden", command: "garden show", why: "find a bed" }] });
      return { text: `${bed} at ${context.folder}` };
    },
  });
  const garden: VerbFamily<VerbPlace> = { name: "garden", summary: "the garden", order: 1, verbs: [look] };
  const [declared] = garden.verbs;
  assert.equal(mounted(declared!.command), true);
  assert.equal(mounted(declared!.tool), false);
  assert.equal(!mounted(declared!.tool) && declared!.tool.absent, "an agent reads the plan instead");

  assert.equal((await declared!.act({ bed: "north" }, { folder: "/work" }, { door: "command", say: (step) => step.command! })).text, "north at /work");
  await assert.rejects(declared!.act({ bed: "pond" }, { folder: "/work" }, { door: "tool", say: (step) => step.tool! }), (error: unknown) =>
    error instanceof VerbRefusal && error.name === "VerbRefusal" && !error.misuse && error.next.length === 1 && error.next[0]!.tool === "show_garden");
  const misuse = new VerbRefusal("this needs <bed>", { misuse: true });
  assert.equal(misuse.misuse, true);
  assert.deepEqual(misuse.next, []);
});

test("16.2 · a verb declares who calls it, an agent, a person, the watcher or several: left out it is an agent and a person, and an agent-only verb is an agent's", () => {
  assert.deepEqual(consumersOf({ consumers: ["user"] }), ["user"]);
  assert.deepEqual(consumersOf({ consumers: ["watcher"] }), ["watcher"]);
  assert.equal(judgedByLines(["agent"]), true, "an agent session's every call writes a door line");
  assert.equal(judgedByLines(["watcher"]), false, "the watcher runs with no agent session, so its calls write none");
  assert.equal(judgedByLines(["agent", "user"]), false);
  assert.deepEqual(consumersOf({}), ["agent", "user"]);
  assert.deepEqual(consumersOf({ agentOnly: "it closes out the agent session that runs it" }), ["agent"]);
});

test("16.3 · a write names where it goes, a project, an arc or an increment: none is refused saying what to give, a project is read from the folder's factory's circle, and an arc or increment lands in the library holding it (ADR-1348 D3)", async () => {
  const records = { factory: { arc_f: "arc" }, site: { arc_s: "arc", increment_s: "increment" }, other: {} } as Record<string, Record<string, string>>;
  const libraries = new Map<string, Library>();
  const named = (name: string): Library => ({
    name,
    get: async (id: string) => (records[name]![id] === undefined ? null : { id, type: records[name]![id] }),
    reach: async (project: string) => {
      if (project === "other") throw Object.assign(new Error(`Project "other" is neither factory "factory" nor a project that names it.`), { name: "OutsideCircleError" });
      if (project === "gone") throw Object.assign(new Error(`Project "gone" is not on this server.`), { name: "ProjectGoneError" });
      if (project === "down") throw new Error("connection refused");
      return libraries.get(project)!;
    },
    reachAll: async () => [{ project: "site", opened: libraries.get("site")! }, { project: "gone", unopened: "it is not on this server" }],
  }) as unknown as Library;
  for (const name of ["factory", "site", "other"]) libraries.set(name, named(name));
  const factory = libraries.get("factory")!;
  const refused = (pattern: RegExp) => (error: unknown) => error instanceof VerbRefusal && error.misuse && pattern.test(error.message);

  assert.deepEqual(whereOf({ project: " site ", arc: "  ", title: "x" }), { project: "site", arc: undefined, increment: undefined });
  await assert.rejects(writtenLibrary(factory, {}), refused(/names where it goes.*give project.*this folder's is "factory".*arc or the increment/));
  assert.equal(await writtenLibrary(factory, { project: "factory" }), factory);
  assert.equal((await writtenLibrary(factory, { project: "site" })).name, "site");
  await assert.rejects(writtenLibrary(factory, { project: "other" }), refused(/"other" is neither factory.*A write names this folder's project \("factory"\)/));
  await assert.rejects(writtenLibrary(factory, { project: "gone" }), refused(/"gone" is not on this server/));
  await assert.rejects(writtenLibrary(factory, { project: "down" }), (error: unknown) => !(error instanceof VerbRefusal) && error instanceof Error && error.message === "connection refused", "a library that fails to open is no refusal");
  assert.equal(await writtenLibrary(factory, { arc: "arc_f" }), factory, "an arc in the folder's own library");
  assert.equal((await writtenLibrary(factory, { increment: "increment_s" })).name, "site", "an increment carries its project, found in the circle");
  assert.equal((await writtenLibrary(factory, { project: "site", arc: "arc_s", increment: "increment_s" })).name, "site");
  await assert.rejects(writtenLibrary(factory, { project: "factory", arc: "arc_s" }), refused(/Project "factory" holds no arc arc_s/));
  await assert.rejects(writtenLibrary(factory, { arc: "arc_f", increment: "increment_s" }), refused(/Project "factory" holds no increment increment_s/));
  await assert.rejects(writtenLibrary(factory, { increment: "arc_s" }), refused(/No library this folder reads holds increment arc_s/), "an id of another kind is no increment");
});

test("16.4 · a library of the folder's factory's circle whose database is dropped while it is searched for an arc or increment holds nothing: the write is refused as no library holding it, or lands in a later one holding it, and any other failure reading it is no refusal", async () => {
  const pgError = (code: string, message: string) => Object.assign(new Error(message), { code });
  const member = (name: string, get: (id: string) => Promise<unknown>): Library => ({ name, get }) as unknown as Library;
  const site = member("site", async (id) => ({ arc_s: { id, type: "arc" }, increment_s: { id, type: "increment" } } as Record<string, unknown>)[id] ?? null);
  const dropped = () => member("dropped", async () => { throw pgError("3D000", 'database "storytree_dropped" does not exist'); });
  const ending = () => {
    let calls = 0;
    return member("ending", async () => {
      calls += 1;
      if (calls === 1) throw pgError("57P01", "terminating connection due to administrator command");
      throw pgError("3D000", 'database "storytree_ending" does not exist');
    });
  };
  const connectionRefused = new Error("connection refused");
  const down = member("down", async () => { throw connectionRefused; });
  const folder = (...circle: Library[]): Library => ({
    name: "factory",
    get: async () => null,
    reachAll: async () => circle.map((opened) => ({ project: opened.name, opened })),
  }) as unknown as Library;
  const refused = (pattern: RegExp) => (error: unknown) => error instanceof VerbRefusal && error.misuse && pattern.test(error.message);

  await assert.rejects(writtenLibrary(folder(dropped()), { increment: "increment_s" }), refused(/^No library this folder reads holds increment increment_s:/), "a database gone (3D000) holds nothing");
  await assert.rejects(writtenLibrary(folder(dropped()), { arc: "arc_s" }), refused(/^No library this folder reads holds arc arc_s:/), "an arc is searched for as an increment is");
  assert.equal(await writtenLibrary(folder(dropped(), site), { increment: "increment_s" }), site, "the gone one is skipped, not the search stopped");
  assert.equal(await writtenLibrary(folder(dropped(), site), { arc: "arc_s" }), site);
  await assert.rejects(writtenLibrary(folder(ending()), { increment: "increment_s" }), refused(/^No library this folder reads holds increment increment_s:/), "a forced drop ending the connection (57P01), then the database gone (3D000), holds nothing");
  assert.equal(await writtenLibrary(folder(ending(), site), { increment: "increment_s" }), site);
  await assert.rejects(writtenLibrary(folder(down, site), { increment: "increment_s" }), (error: unknown) => error === connectionRefused, "any other failure reading a member is passed through, no refusal");
});

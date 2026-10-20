import assert from "node:assert/strict";
import { test } from "node:test";
import { VerbRefusal, type DoorWords, type VerbContext } from "@storytree/library/verbs";
import { MAP_FAMILIES } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => step.command ?? step.tool! };
const unopened = new Proxy({}, { get: (_target, name) => { throw new Error(`the library was read: ${String(name)}`); } });
const context = { folder: process.cwd(), project: "p", session: "s", library: unopened, server: unopened } as unknown as VerbContext;
const bare = (name: string) => MAP_FAMILIES.find((family) => family.name === name)!.bare!;
const given = { select: undefined, crossing: undefined, given: undefined, range: undefined, up: undefined, down: undefined, kind: undefined, "dry-run": false, show: false, json: false };

async function refused(name: string, input: Record<string, unknown>): Promise<VerbRefusal> {
  const error = await bare(name).act({ ...given, ...input }, context, WORDS).then(() => undefined, (thrown: unknown) => thrown);
  assert.ok(error instanceof VerbRefusal, String(error));
  assert.equal(error.misuse, true);
  return error;
}

test("3.4 the map command, declared as Code map's map and affected families, refuses a selection it cannot answer as a misuse before it reads the library", async () => {
  assert.deepEqual(MAP_FAMILIES.map(({ name, order }) => [name, order]), [["map", 16], ["affected", 17]]);
  assert.match((await refused("map", { select: "story:x", show: true, "dry-run": true })).message, /either --show or --dry-run/);
  assert.match((await refused("map", {})).message, /needs --select/);
  assert.match((await refused("map", { crossing: " , " })).message, /Name the folders/);
  assert.match((await refused("map", { crossing: "src", select: "file:x" })).message, /names a mapped story/);
  assert.match((await refused("affected", { given: "a..b", range: "c..d" })).message, /Give one range/);
  assert.match((await refused("affected", { show: true, "dry-run": true })).message, /either --show or --dry-run/);
});

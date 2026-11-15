import assert from "node:assert/strict";
import { test } from "node:test";
import { VerbRefusal, type DoorWords, type VerbContext } from "@storytree/library/verbs";
import { PIN_FAMILIES } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => step.command ?? step.tool! };
const unopened = new Proxy({}, { get: (_target, name) => { throw new Error(`the library was read: ${String(name)}`); } });
const context = { folder: process.cwd(), project: "p", session: "s", library: unopened, server: unopened } as unknown as VerbContext;

test("9.1 · the pin family's new verb, its pin tool, refuses an anchor or icon it cannot read as a misuse before it reads the library", async () => {
  const [family] = PIN_FAMILIES;
  assert.deepEqual(family!.verbs.map(({ command, tool }) => ["name" in command ? command.name : undefined, "name" in tool ? tool.name : undefined]), [["new", "pin"], ["list", "pins"], ["retire", "retire_pin"]]);
  const pinNew = family!.verbs[0]!;
  for (const [input, said] of [[{ on: "somewhere", icon: "cache" }, /Name what to pin on/], [{ on: "capability_0a", icon: "rocket" }, /icon is one of cache, queue, store/]] as const) {
    const error = await pinNew.act({ label: "x", evidence: "y", commit: undefined, ...input }, context, WORDS).then(() => undefined, (thrown: unknown) => thrown);
    assert.ok(error instanceof VerbRefusal, String(error));
    assert.equal(error.misuse, true);
    assert.match(error.message, said);
  }
});

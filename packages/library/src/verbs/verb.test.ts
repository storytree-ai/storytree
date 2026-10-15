// Capability 16 · The command schema: the shapes a story declares its verbs with, which every story downstream imports
// from the library and each front door reads (ADR-1035 D1).
import assert from "node:assert/strict";
import { test } from "node:test";

import { consumersOf, mounted, verb, VerbRefusal, type VerbFamily, type VerbPlace } from "./verb.js";

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

test("16.2 · a verb declares who calls it, an agent, a person or both: left out it is both, and an agent-only verb is an agent's", () => {
  assert.deepEqual(consumersOf({ consumers: ["user"] }), ["user"]);
  assert.deepEqual(consumersOf({}), ["agent", "user"]);
  assert.deepEqual(consumersOf({ agentOnly: "it closes out the agent session that runs it" }), ["agent"]);
});

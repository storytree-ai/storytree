/**
 * Capability 1 · Front door: contract 1.23, the command line mounting a declared family whole. The family and its verbs
 * are this test's own, acted on a context that hands the caller with no library behind it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { verb, type VerbFamily } from "@storytree/project-and-caller/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";

import { parseArgs } from "./args.js";
import type { Context } from "./door.js";
import { family } from "./mount.js";

const gather = verb({
  command: { family: "garden bed", name: "gather", summary: "gather what grew" },
  tool: { absent: "a test verb" },
  inputs: {
    beds: { kind: "text", word: 0, many: true, describe: "the beds to gather from" },
    basket: { kind: "text", many: true, optional: true, describe: "a basket to fill" },
    tags: { kind: "fields", describe: "a tag to put on what is gathered" },
  },
  writes: true,
  async act({ beds, basket, tags }, context: SessionVerbContext) {
    return { text: `${beds.join("+")} into ${basket.join("+")} ${JSON.stringify(tags)} by ${context.writer?.actor ?? "nobody"}`, raw: true, next: [{ command: "garden", why: "unprinted" }] };
  },
});

const look = verb({
  command: { family: "garden", name: "look", summary: "look at the garden" },
  tool: { absent: "a test verb" },
  inputs: {},
  async act(_input, context: SessionVerbContext) {
    return { text: `looked by ${context.writer?.actor ?? "nobody"}`, next: [{ command: "garden bed gather <beds>", why: "gather" }] };
  },
});

const garden: VerbFamily<SessionVerbContext> = {
  name: "garden",
  summary: "the garden",
  order: 1,
  verbs: [look],
  families: [{ name: "bed", summary: "one bed", verbs: [gather] }],
  guesses: { dig: "garden bed gather <beds>" },
  retired: { mow: { why: "the lawn is gone", instead: "garden look" } },
};

/** A context whose caller is handed with no library opened, and which counts each time the writer is asked for. */
function contextOf(): { context: Context; writers: number[] } {
  const writers: number[] = [];
  const caller = { library: {}, project: "p", session: "claude-1", folder: "/work", log: {} } as unknown as Awaited<ReturnType<Context["activityContext"]>>;
  const context = {
    cwd: "/work",
    activityContext: async () => caller,
    writer: () => { writers.push(1); return { actor: "session:claude-1" }; },
  } as unknown as Context;
  return { context, writers };
}

test("1.23 · the command line mounts a declared family with the families within it, its guesses and its retired words; a verb's many words and repeated flags, and every flag as a field, reach its work; a verb that writes is handed the writer the answer names, and a raw answer is printed as it is", async () => {
  const mounted = family(garden);
  assert.deepEqual(mounted.guesses, garden.guesses);
  assert.deepEqual(mounted.retired, garden.retired);
  assert.equal(mounted.families?.[0]?.name, "bed");
  const gathering = mounted.families?.[0]?.verbs[0];
  assert.equal(gathering?.usage, "garden bed gather <beds> … [--basket <basket> …] --<field> <value> …");

  const writing = contextOf();
  const gathered = await gathering!.act(parseArgs(["north", "south", "--basket", "wicker", "--basket", "tin", "--colour", "red"], [], "/work"), writing.context);
  assert.deepEqual(gathered, { text: `north+south into wicker+tin {"colour":"red"} by session:claude-1`, raw: true }, "raw: no next steps");
  assert.equal(writing.writers.length, 1, "asking for the writer is what names it below the answer");

  const reading = contextOf();
  const looked = await mounted.verbs[0]!.act(parseArgs([], [], "/work"), reading.context);
  assert.deepEqual(looked, { text: "looked by nobody", next: [{ command: "storytree garden bed gather <beds>", why: "gather" }] });
  assert.equal(reading.writers.length, 0, "a verb that does not write names no writer");
});

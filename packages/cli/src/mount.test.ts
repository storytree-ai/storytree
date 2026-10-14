/**
 * Capability 1 · Front door: contract 1.23, the command line mounting a declared family whole, and contract 1.24, the
 * mount of a declared verb called with a context whose library cannot open. The families and verbs are this test's own.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { verb, VerbRefusal, type VerbFamily, type VerbPlace } from "@storytree/project-and-caller/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";

import { Refusal } from "./answer.js";
import { parseArgs } from "./args.js";
import type { Context } from "./door.js";
import { command, family, type CommandPlace } from "./mount.js";

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

const water = verb({
  command: { family: "garden", name: "water", summary: "water the garden, unless it rained" },
  tool: { absent: "a test verb" },
  inputs: { rained: { kind: "switch", describe: "it rained" } },
  writes: true,
  async act({ rained }, context: SessionVerbContext) {
    return { text: rained ? "No change: it rained." : `watered by ${context.writer!.actor} and ${context.writer!.actor}` };
  },
});

const weed = verb({
  command: { family: "garden", name: "weed", summary: "weed the garden" },
  tool: { absent: "a test verb" },
  inputs: {},
  async act() {
    throw new VerbRefusal("no weeds grow here", { next: [{ command: "garden look", why: "look again" }] });
  },
});

const garden: VerbFamily<SessionVerbContext> = {
  name: "garden",
  summary: "the garden",
  order: 1,
  verbs: [look, water, weed],
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

test("1.23 · the command line mounts a declared family with the families within it, its guesses and its retired words; a verb's many words and repeated flags, and every flag as a field, reach its work; a verb that writes is handed the writer the answer names once its work asks for it, a refusal names its next steps as commands, and a raw answer is printed as it is", async () => {
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

  const dry = contextOf();
  assert.deepEqual(await mounted.verbs[1]!.act(parseArgs(["--rained"], ["rained"], "/work"), dry.context), { text: "No change: it rained." });
  assert.equal(dry.writers.length, 0, "a writing verb whose work wrote nothing names no writer");
  const wet = contextOf();
  assert.deepEqual(await mounted.verbs[1]!.act(parseArgs([], ["rained"], "/work"), wet.context), { text: "watered by session:claude-1 and session:claude-1" });
  assert.equal(wet.writers.length, 1, "the writer is asked for once, however often the work reads it");

  await assert.rejects(mounted.verbs[2]!.act(parseArgs([], [], "/work"), contextOf().context), (error: unknown) =>
    error instanceof Refusal && error.code === 1 && error.message === "no weeds grow here" && JSON.stringify(error.next) === JSON.stringify([{ command: "storytree garden look", why: "look again" }]));
});

const runtime = { record: () => {} };
const noLibrary = (): never => { throw new Error("the library was opened"); };
const context = {
  cwd: "/not-a-project",
  script: "/opt/storytree/storytree.mjs",
  out: () => {},
  library: noLibrary,
  server: noLibrary,
  writer: noLibrary,
  claims: noLibrary,
  activityContext: noLibrary,
  claimContext: noLibrary,
  journey: async () => runtime,
} as unknown as Context;

const status = verb({
  command: { family: "journey", name: "status", summary: "say whether journey events are on" },
  tool: { absent: "the person's own setting" },
  inputs: {},
  callerless: true,
  async act(_input, place: VerbPlace & Partial<CommandPlace>) {
    const journey = await place.journey!();
    return { text: `${place.folder} ${place.script} ${(journey as unknown) === runtime ? "runtime" : "another"}` };
  },
});

test("1.24 · the command line mounts a callerless verb without opening the library, handing it the folder, script and journey runtime; a word or flag a verb does not take is refused with code 2 and its usage", async () => {
  const mounted = command(status);
  assert.equal((await mounted.act(parseArgs([], [], context.cwd), context)).text, "/not-a-project /opt/storytree/storytree.mjs runtime");

  for (const stray of [["extra"], ["--key", "x"]]) {
    await assert.rejects(mounted.act(parseArgs(stray, [], context.cwd), context), (error: unknown) => error instanceof Refusal && error.code === 2 && error.message.endsWith("\nusage: storytree journey status") && !error.message.includes("extra"));
  }

  // A verb that is not callerless opens the caller.
  const { callerless: _callerless, ...called } = status;
  await assert.rejects(command(called).act(parseArgs([], [], context.cwd), context), /the library was opened/);
});

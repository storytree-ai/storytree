// Capability 4 · The verb contract: a verb declared once reads either door's input the same, refuses the same wrong
// input on both, and does the same work and answers in the same sentence for either door. The verbs are this test's
// own, one of them on a context its declaring story extends.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { commandInput, commandUsage, mounted, toolInput, verb, VerbRefusal, type DoorWords, type VerbContext, type VerbFamily } from "./verb.js";

const DOORS: Record<"command" | "tool", DoorWords> = {
  command: { door: "command", say: (step) => step.command === undefined ? step.tool! : `storytree ${step.command}` },
  tool: { door: "tool", say: (step) => step.tool ?? `storytree ${step.command!}` },
};

function given(words: readonly string[], flags: Readonly<Record<string, string | readonly string[]>>) {
  const all = (name: string): readonly string[] => { const value = flags[name]; return value === undefined ? [] : typeof value === "string" ? [value] : value; };
  return { word: (index: number) => words[index], flag: (name: string) => all(name).at(-1), flags: all, has: (name: string) => name in flags, names: () => Object.keys(flags) };
}

/** The declaring story's own context: what its verbs need beyond the caller, here a tally the work writes to. */
interface TallyContext extends VerbContext {
  readonly tally: string[];
}

const plant = verb({
  command: { family: "garden", name: "plant", summary: "plant a tree" },
  tool: { name: "plant_tree", description: "Plant a tree." },
  inputs: {
    tree: { kind: "text", word: 0, describe: "which tree" },
    water: { kind: "yes-no", describe: "water it too" },
    label: { kind: "text", describe: "its label" },
    quiet: { kind: "switch", describe: "say less" },
  },
  async act({ tree, water, label, quiet }, context: TallyContext, words) {
    if (tree === "weed") throw new VerbRefusal("a weed is not planted");
    context.tally.push(`${context.session}:${tree}`);
    return {
      text: quiet ? `Planted ${tree}.` : `Planted ${tree} (${label})${water ? ", watered" : ""} for ${context.session}.`,
      data: { tree },
      next: [{ tool: "show_garden", command: "garden show", why: `see it: ${words.say({ tool: "show_garden", command: "garden show" })}` }],
    };
  },
});

const sweep = verb({
  command: { family: "garden", name: "sweep", summary: "sweep the paths" },
  tool: { absent: "an agent has no broom" },
  inputs: {},
  async act(_input, context) {
    return { text: `Swept for ${context.project}.` };
  },
});

test("4.1 · a verb declared once reads a command's words and flags and a tool's arguments to the same input, refuses the same wrong input on both, and does the same work and answers in the same sentence for either door", async () => {
  assert.equal(commandUsage(plant), "garden plant <tree> --water yes|no --label <label> [--quiet]");
  const fromCommand = commandInput(plant, given(["oak"], { water: "yes", label: " by the gate " }));
  const fromTool = toolInput(plant, { tree: "oak", water: true, label: "by the gate" });
  assert.deepEqual(fromCommand, fromTool);
  assert.deepEqual(fromTool, { tree: "oak", water: true, label: "by the gate", quiet: false });

  // Wrong input is refused on both doors, as a misuse the command line shows its usage for.
  for (const refused of [
    () => commandInput(plant, given([], { water: "yes", label: "x" })),
    () => commandInput(plant, given(["oak"], { water: "maybe", label: "x" })),
    () => commandInput(plant, given(["oak"], { label: "x" })),
    () => commandInput(plant, given(["oak"], { water: "no", label: "  " })),
    () => toolInput(plant, { tree: "  ", water: true, label: "x" }),
  ]) assert.throws(refused, (error: unknown) => error instanceof VerbRefusal && error.misuse);

  // A door that does not mount a verb says why, and the other still does.
  assert.equal(mounted(sweep.tool), false);
  assert.equal("absent" in sweep.tool && sweep.tool.absent, "an agent has no broom");
  assert.equal(commandUsage(sweep), "garden sweep");
  assert.deepEqual(toolInput(sweep, {}), {});

  const tally: string[] = [];
  const context: TallyContext = { library: {} as Library, project: "p", session: "claude-1", folder: "/work", tally };
  const byCommand = await plant.act(fromCommand, context, DOORS.command);
  const byTool = await plant.act(fromTool, context, DOORS.tool);
  assert.equal(byCommand.text, "Planted oak (by the gate), watered for claude-1.");
  assert.equal(byTool.text, byCommand.text);
  assert.deepEqual(tally, ["claude-1:oak", "claude-1:oak"], "the same work, once for each door");
  // Each door names the step it offers next in its own terms.
  assert.equal(byCommand.next?.[0]?.why, "see it: storytree garden show");
  assert.equal(byTool.next?.[0]?.why, "see it: show_garden");
  assert.equal((await sweep.act({}, context, DOORS.command)).text, "Swept for p.");

  // A refusal from the work is the verb's own, on either door, and is not a misuse.
  for (const door of [DOORS.command, DOORS.tool]) {
    await assert.rejects(plant.act({ tree: "weed", water: false, label: "x", quiet: false }, context, door), (error: unknown) => error instanceof VerbRefusal && !error.misuse && error.message === "a weed is not planted");
  }
});

const prune = verb({
  command: { family: "garden", name: "prune", summary: "prune a tree", usage: "garden prune <tree|hedge> [--to <height> --by <tool>]" },
  tool: { name: "prune_tree", description: "Prune a tree." },
  inputs: {
    tree: { kind: "text", word: 0, describe: "which tree or hedge" },
    to: { kind: "text", optional: true, describe: "the height to prune it to" },
    by: { kind: "text", optional: true, describe: "the tool to prune it with" },
  },
  async act({ tree, to }) {
    return { text: to === undefined ? `Pruned ${tree}.` : `Pruned ${tree} to ${to}.` };
  },
});

test("4.2 · a text input marked optional may be left out on either door and reads as nothing; a verb's command may give the usage its inputs cannot spell, and a family may declare the verb its bare name runs", async () => {
  assert.equal(commandUsage(prune), "garden prune <tree|hedge> [--to <height> --by <tool>]");
  assert.equal(commandUsage(sweep), "garden sweep", "a verb that gives none has the usage its inputs spell");
  const left = commandInput(prune, given(["oak"], {}));
  assert.deepEqual(left, toolInput(prune, { tree: "oak" }));
  assert.deepEqual(left, { tree: "oak", to: undefined, by: undefined });
  assert.deepEqual(commandInput(prune, given(["oak"], { to: " 2m " })), toolInput(prune, { tree: "oak", to: "2m" }));
  // Given, it is still refused when it says nothing, on both doors.
  for (const refused of [() => commandInput(prune, given(["oak"], { to: " " })), () => toolInput(prune, { tree: "oak", to: " " })]) {
    assert.throws(refused, (error: unknown) => error instanceof VerbRefusal && error.misuse);
  }
  const context: VerbContext = { library: {} as Library, project: "p", session: "claude-1", folder: "/work" };
  assert.equal((await prune.act(left, context, DOORS.command)).text, "Pruned oak.");

  const garden: VerbFamily = { name: "garden", summary: "the garden", order: 1, verbs: [sweep], bare: prune };
  assert.equal(commandUsage(garden.bare!), "garden prune <tree|hedge> [--to <height> --by <tool>]");
});

const gather = verb({
  command: { family: "garden", name: "gather", summary: "gather what grew" },
  tool: { name: "gather", description: "Gather what grew." },
  inputs: {
    beds: { kind: "text", word: 0, many: true, describe: "the beds to gather from" },
    basket: { kind: "text", many: true, optional: true, describe: "a basket to fill" },
    tags: { kind: "fields", describe: "a tag to put on what is gathered" },
  },
  writes: true,
  async act({ beds, basket, tags }, context) {
    return { text: `${beds.join("+")} into ${basket.length === 0 ? "nothing" : basket.join("+")} ${JSON.stringify(tags)} by ${context.writer?.actor ?? "nobody"}`, raw: true };
  },
});

test("4.4 · a text input may be many, each word from its place on or each repetition of its flag, and none when optional; an open set of fields takes every flag the other inputs do not name; a verb may declare that it writes and answer raw", async () => {
  assert.equal(commandUsage(gather), "garden gather <beds> … [--basket <basket> …] --<field> <value> …");
  const fromCommand = commandInput(gather, given(["north", "south"], { basket: ["wicker", " tin "], colour: "red", size: " big " }));
  const fromTool = toolInput(gather, { beds: ["north", "south"], basket: ["wicker", "tin"], tags: { colour: "red", size: " big " } });
  assert.deepEqual(fromCommand, fromTool);
  assert.deepEqual(fromCommand, { beds: ["north", "south"], basket: ["wicker", "tin"], tags: { colour: "red", size: " big " } }, "each of many is trimmed; a field is as given");
  assert.deepEqual(commandInput(gather, given(["north"], {})), toolInput(gather, { beds: ["north"] }));
  assert.deepEqual(commandInput(gather, given(["north"], {})), { beds: ["north"], basket: [], tags: {} });
  for (const refused of [() => commandInput(gather, given([], {})), () => toolInput(gather, { beds: [] }), () => commandInput(gather, given(["north", " "], {}))]) {
    assert.throws(refused, (error: unknown) => error instanceof VerbRefusal && error.misuse);
  }
  assert.equal(gather.writes, true);
  const context: VerbContext = { library: {} as Library, project: "p", session: "claude-1", folder: "/work", writer: { actor: "session:claude-1" } };
  const answer = await gather.act(fromCommand, context, DOORS.command);
  assert.equal(answer.text, `north+south into wicker+tin {"colour":"red","size":" big "} by session:claude-1`);
  assert.equal(answer.raw, true);

  const plot: VerbFamily = { name: "garden", summary: "the garden", order: 1, verbs: [sweep], families: [{ name: "bed", summary: "one bed", verbs: [gather] }], guesses: { dig: "garden plant <tree>" }, retired: { mow: { why: "the lawn is gone", instead: "garden sweep" } } };
  assert.equal(plot.families?.[0]?.verbs[0], gather);
});

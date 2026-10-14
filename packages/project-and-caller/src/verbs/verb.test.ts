// Capability 4 · The verb contract: a verb declared once reads either door's input the same, refuses the same wrong
// input on both, and does the same work and answers in the same sentence for either door. The verbs are this test's
// own, one of them on a context its declaring story extends.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Library } from "@storytree/library";

import { commandInput, commandUsage, mounted, toolInput, verb, VerbRefusal, type DoorWords, type VerbContext, type VerbFamily, type VerbPlace } from "./verb.js";

const DOORS: Record<"command" | "tool", DoorWords> = {
  command: { door: "command", say: (step) => step.command === undefined ? step.tool! : `storytree ${step.command}` },
  tool: { door: "tool", say: (step) => step.tool ?? `storytree ${step.command!}` },
};

function given(words: readonly string[], flags: Readonly<Record<string, string>>) {
  return { word: (index: number) => words[index], count: words.length, flag: (name: string) => flags[name], has: (name: string) => name in flags, names: Object.keys(flags) };
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

const keep = verb({
  command: { family: "keys", name: "set", summary: "keep a key", usage: "keys set <name> (its key on standard input)" },
  tool: { absent: "a key is not handed to an agent" },
  inputs: { name: { kind: "text", word: 0, describe: "whose key" }, quiet: { kind: "switch", describe: "say less" } },
  callerless: true,
  async act({ name }, context: VerbPlace) {
    return { text: `Kept ${name}'s key from ${context.folder}.` };
  },
});

test("4.5 · a word past the ones a verb takes, or a flag it does not take, is refused as a misuse naming the flag and never the word; a verb may be callerless, its work handed only its place, and a family's bare verb named as the family is used as the family", async () => {
  assert.deepEqual(commandInput(keep, given(["openai"], { quiet: "true" })), { name: "openai", quiet: true });
  const refusal = (words: readonly string[], flags: Readonly<Record<string, string>>): VerbRefusal => {
    try {
      commandInput(keep, given(words, flags));
    } catch (error) {
      if (error instanceof VerbRefusal && error.misuse) return error;
      throw error;
    }
    assert.fail("not refused");
  };
  const stray = refusal(["openai", "sk-secret"], {});
  assert.doesNotMatch(stray.message, /sk-secret/, "a stray word is never echoed: it may be the key");
  assert.match(refusal(["openai"], { key: "sk-secret" }).message, /^--key is not a flag this takes$/);
  // A word input is not also a flag, and a verb that takes nothing takes no word.
  assert.match(refusal(["openai"], { name: "x" }).message, /--name/);
  assert.throws(() => commandInput(sweep, given(["extra"], {})), (error: unknown) => error instanceof VerbRefusal && error.misuse && !error.message.includes("extra"));
  // A verb words its own refusal through its usage: auth set's standard input.
  assert.equal(commandUsage(keep), "keys set <name> (its key on standard input)");

  assert.equal(keep.callerless, true);
  assert.equal((await keep.act({ name: "openai", quiet: false }, { folder: "/nowhere" }, DOORS.command)).text, "Kept openai's key from /nowhere.");

  const lag = verb({ command: { family: "lag", name: "lag", summary: "the lag readings" }, tool: { absent: "the desktop's own" }, inputs: { days: { kind: "text", optional: true, describe: "how many days" } }, callerless: true, async act() { return { text: "" }; } });
  assert.equal(commandUsage(lag), "lag [--days <days>]");
});

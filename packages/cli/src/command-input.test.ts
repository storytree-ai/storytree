// Capability 13 · Reading a command (ADR-1035 D2): the command line reads a declared verb's words and flags to the same
// input the MCP server reads its tool's arguments to, refuses the same wrong input, and the verb does the same work and
// answers in the same sentence for either door. The verbs are this test's own, one of them on a context its declaring
// story extends, besides the declared `release pin` and the session verbs.
import assert from "node:assert/strict";
import { test } from "node:test";

import { RELEASE_FAMILIES } from "@storytree/app/updates/verbs";
import type { Library } from "@storytree/library";

import { mounted, verb, VerbRefusal, type DoorWords, type VerbContext, type VerbFamily, type VerbPlace } from "@storytree/library/verbs";
import { toolInput } from "@storytree/mcp-server/tool-input";
import { SESSION_VERBS } from "@storytree/session-management/verbs";

import { commandInput, commandUsage } from "./command-input.js";

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

test("13.1 · a verb declared once reads a command's words and flags and a tool's arguments to the same input, refuses the same wrong input on both, and does the same work and answers in the same sentence for either door", async () => {
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

  // Session management's declared verbs read the same on both doors.
  const tool = (name: string) => SESSION_VERBS.find((one) => mounted(one.tool) && one.tool.name === name)!;
  const close = tool("close_out");
  assert.equal(commandUsage(close), "session close-out --safe yes|no --why <why>");
  assert.deepEqual(commandInput(close, given([], { safe: "no", why: " handoff " })), toolInput(close, { safe: false, why: "handoff" }));
  for (const refused of [() => commandInput(close, given([], { safe: "maybe", why: "x" })), () => commandInput(close, given([], { safe: "yes", why: "  " })), () => toolInput(close, { safe: true, why: "  " })]) {
    assert.throws(refused, (error: unknown) => error instanceof VerbRefusal && error.misuse);
  }
  const name = tool("name_session");
  assert.equal(commandUsage(name), "session name <title>");
  assert.deepEqual(commandInput(name, given(["Building signup"], {})), toolInput(name, { title: "Building signup" }));
  const list = SESSION_VERBS.find((one) => mounted(one.command) && one.command.name === "list")!;
  assert.equal(commandUsage(list), "session list [--all] [--json]");
  assert.deepEqual(toolInput(list, {}), { all: false, json: false });
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

test("13.2 · a text input marked optional may be left out on either door and reads as nothing; a verb's command may give the usage its inputs cannot spell, and a family may declare the verb its bare name runs", async () => {
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

test("13.4 · a text input may be many, each word from its place on or each repetition of its flag, and none when optional; an open set of fields takes every flag the other inputs do not name; a verb may declare that it writes and answer raw", async () => {
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

test("13.5 · a word past the ones a verb takes, or a flag it does not take, is refused as a misuse naming the flag and never the word; a verb may be callerless, its work handed only its place, and a family's bare verb named as the family is used as the family", async () => {
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

  // The app's declared `release pin` refuses a missing version and a stray word before its act could publish anything.
  const pin = RELEASE_FAMILIES[0]!.verbs.find((each) => mounted(each.command) && each.command.name === "pin")!;
  assert.equal(commandUsage(pin), "release pin <0.3.n> [--preview] [--back | --expedited <why>]");
  assert.throws(() => commandInput(pin, given([], {})), (error) => error instanceof VerbRefusal && error.misuse && error.message === "this needs <version>: the owner's chosen release");
  assert.throws(() => commandInput(pin, given(["0.3.9", "0.3.10"], {})), (error) => error instanceof VerbRefusal && error.misuse && error.message === "this takes one word, and was given 2");
  assert.deepEqual(commandInput(pin, given(["0.3.9"], { preview: "" })), { version: "0.3.9", preview: true, back: false, expedited: undefined });
});

const hold = verb({
  command: { family: "garden", name: "hold", summary: "hold a bed for someone, or for no one" },
  tool: { name: "hold_bed", description: "Hold a bed." },
  inputs: {
    bed: { kind: "text", word: 0, describe: "which bed" },
    for: { kind: "text", optional: true, blank: true, describe: "who for: empty holds it for no one" },
  },
  async act({ bed, for: holder }) {
    if (bed === "pond") throw new VerbRefusal("a pond is no bed", { next: [{ tool: "show_garden", command: "garden show", why: "find a bed" }] });
    return { text: holder === "" ? `${bed} is held for no one.` : `${bed} is held for ${holder ?? "you"}.` };
  },
});

test("13.6 · a text input marked blank keeps a value that says nothing, read as empty, on either door; a refusal may name the steps that do the job instead", async () => {
  const context: VerbContext = { library: {} as Library, project: "p", session: "claude-1", folder: "/work" };
  const blank = commandInput(hold, given(["north"], { for: " " }));
  assert.deepEqual(blank, toolInput(hold, { bed: "north", for: "" }));
  assert.equal((await hold.act(blank, context, DOORS.command)).text, "north is held for no one.");
  assert.throws(() => commandInput(hold, given([" "], { for: "" })), (error: unknown) => error instanceof VerbRefusal && error.misuse, "an input not marked blank still refuses one");

  await assert.rejects(hold.act(commandInput(hold, given(["pond"], {})), context, DOORS.command), (error: unknown) =>
    error instanceof VerbRefusal && !error.misuse && error.next.length === 1 && DOORS.tool.say(error.next[0]!) === "show_garden" && DOORS.command.say(error.next[0]!) === "storytree garden show");
});

const label = verb({
  command: { family: "garden", name: "label", summary: "find a label as it was written" },
  tool: { name: "find_label", description: "Find a label." },
  inputs: {
    text: { kind: "text", word: 0, verbatim: true, describe: "the label, its spaces included" },
    bed: { kind: "text", optional: true, describe: "which bed" },
  },
  async act({ text }) {
    return { text: JSON.stringify(text) };
  },
});

test("13.7 · a text input marked verbatim keeps its value as given, its leading and trailing whitespace included, on either door", () => {
  const read = commandInput(label, given(["  Rose bed  "], { bed: "  north  " }));
  assert.deepEqual(read, { text: "  Rose bed  ", bed: "north" }, "only the verbatim input keeps its spaces");
  assert.deepEqual(toolInput(label, { text: "  Rose bed  ", bed: "  north  " }), read);
  assert.throws(() => commandInput(label, given(["   "], {})), (error: unknown) => error instanceof VerbRefusal && error.misuse, "one that says nothing is still refused");
});

const count = verb({
  command: { family: "garden", name: "count", summary: "count the beds" },
  tool: { name: "count_beds", description: "Count the beds." },
  inputs: {
    limit: { kind: "count", optional: true, describe: "how many beds to count" },
    rows: { kind: "count", describe: "how many rows" },
    notes: { kind: "fields", json: true, describe: "a note on each bed" },
  },
  async act({ rows, limit, notes }) {
    return { text: `Counted ${rows} rows, ${limit ?? "every"} bed, notes ${JSON.stringify(notes)}.` };
  },
});

test("13.8 · a count input is a whole number above 0, left out only when optional, and a fields input marked json takes any JSON value, a command's read as JSON where it parses, on either door", () => {
  assert.equal(commandUsage(count), "garden count [--limit <n>] --rows <n> --<field> <value> …");
  const read = commandInput(count, given([], { rows: "3", limit: "2", oak: "[\"by the gate\"]", ash: "tall", elm: "{\"height\":4}" }));
  assert.deepEqual(read, { limit: 2, rows: 3, notes: { oak: ["by the gate"], ash: "tall", elm: { height: 4 } } });
  assert.deepEqual(toolInput(count, { rows: 3, limit: 2, notes: { oak: ["by the gate"], ash: "tall", elm: { height: 4 } } }), read);
  assert.deepEqual(commandInput(count, given([], { rows: "3" })), { limit: undefined, rows: 3, notes: {} });
  assert.deepEqual(toolInput(count, { rows: 3 }), { limit: undefined, rows: 3, notes: {} });
  for (const rows of ["0", "2.5", "three", "-1"]) {
    assert.throws(() => commandInput(count, given([], { rows })), (error: unknown) => error instanceof VerbRefusal && error.misuse && error.message.includes("--rows"), `rows ${rows} is refused`);
  }
  assert.throws(() => commandInput(count, given([], {})), (error: unknown) => error instanceof VerbRefusal && error.misuse, "a required count left out is refused");
  assert.throws(() => toolInput(count, {}), (error: unknown) => error instanceof VerbRefusal && error.misuse, "a required count left out is refused");
});

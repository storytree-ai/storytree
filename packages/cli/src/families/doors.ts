/**
 * Capability 1 · Front door. `storytree doors`: how the two front doors are used, read on demand (ADR-0998 D1), a thin
 * front door over Reading the front doors. The declared surfaces it counts against are the doors' own:
 * every command walked from this door's table, and every tool the tool server serves in this folder.
 * Nothing recurs and nothing is written; it prints and ends.
 */
import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

const usage = "doors [--days <n>] [--trend <n>] [--json]";

/** Every command the door answers, as its door-answered lines name it: a family's verbs, its bare command, and its families' within it. */
function commandsOf(families: readonly Family[], path = "storytree"): string[] {
  return families.filter((family) => family.waitsOn === undefined).flatMap((family) => {
    const at = `${path} ${family.name}`;
    return [...(family.bare === undefined ? [] : [at]), ...family.verbs.map((verb) => `${at} ${verb.name}`), ...commandsOf(family.families ?? [], at)];
  });
}

/** A flag's whole number of days, 1 or more, or `fallback` when it is not given. */
function daysOf(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback;
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1) throw new Refusal(`--${flag} takes a whole number of days, 1 or more\nusage: storytree ${usage}`, { code: 2 });
  return days;
}

const read: Verb = {
  name: "doors",
  usage,
  summary: "every command and tool with its calls and sessions, the words refused as unknown, follows and failures, for the last --days (7) with --trend (28) beside it",
  switches: ["json"],
  async act(args, context) {
    const days = daysOf(args.text("days"), "days", 7);
    const trend = daysOf(args.text("trend"), "trend", 28);
    const { log, project } = await context.activityContext();
    const [{ FAMILIES }, { servedTools }, { readDoors, doorsJson, doorsTable }] = await Promise.all([
      import("./index.js"), import("@storytree/mcp-server"), import("@storytree/reading-the-front-doors"),
    ]);
    const declared = { commands: commandsOf(FAMILIES), tools: await servedTools(context.cwd) };
    const [short, long] = await readDoors(log, project, declared, new Date(), [days, trend]);
    return args.has("json") ? { text: doorsJson(short!, long!), raw: true } : { text: doorsTable(short!, long!) };
  },
};

export const doors: Family = {
  name: "doors",
  summary: "how the command line and the tools are used (read only)",
  verbs: [],
  bare: read,
};

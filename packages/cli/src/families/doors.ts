/**
 * Capability 1 · Front door. `storytree doors`: how the two front doors are used, read on demand (ADR-0998 D1), a thin
 * front door over this door's usage reading (capability 14, ADR-1071 D3). The declared surfaces it counts against are the doors' own:
 * every command walked from this door's table, and every tool the tool server serves in this folder, each with
 * the consumers its story declared for it (ADR-1045 D1).
 * Nothing recurs and nothing is written; it prints and ends. `storytree doors learn` runs the doors learner alone, for the
 * tool server's friction_drain (ADR-1045 D7 on both doors): the tool server cannot import this door, so it runs this command.
 */
import type { DeclaredVerb } from "../usage/reading.js";
import { consumersOf } from "@storytree/library/verbs";

import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";
import type { learn } from "./drain.js";

const usage = "doors [--days <n>] [--trend <n>] [--json]";

/**
 * Every command the door answers, as its door-answered lines name it, with its consumers: a family's verbs, its bare
 * command, and its families' within it.
 */
export function commandsOf(families: readonly Family[], path = "storytree"): DeclaredVerb[] {
  return families.filter((family) => family.waitsOn === undefined).flatMap((family) => {
    const at = `${path} ${family.name}`;
    const named = (verb: string, declared: Verb) => ({ verb, consumers: consumersOf(declared) });
    return [...(family.bare === undefined ? [] : [named(at, family.bare)]), ...family.verbs.map((verb) => named(`${at} ${verb.name}`, verb)), ...commandsOf(family.families ?? [], at)];
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
    const [{ FAMILIES }, { servedTools }, { readDoors }, { doorsJson, doorsTable }] = await Promise.all([
      import("./index.js"), import("@storytree/mcp-server"), import("../usage/read.js"), import("../usage/table.js"),
    ]);
    const tools = (await servedTools(context.cwd)).map(({ name, consumers }) => ({ verb: name, consumers }));
    const declared = { commands: commandsOf(FAMILIES), tools };
    const [short, long] = await readDoors(log, project, declared, new Date(), [days, trend]);
    return args.has("json") ? { text: doorsJson(short!, long!), raw: true } : { text: doorsTable(short!, long!) };
  },
};

const learnUsage = "doors learn --session <id> [--harness <harness>]";

/**
 * `storytree doors learn`: the doors learner on the session `--session` names, writing as it. The tool server runs it after
 * its friction_drain, with no session in the shell, so the command records no call of its own on the doors it reads.
 */
export function learner(run?: typeof learn): Verb {
  return {
    name: "learn",
    usage: learnUsage,
    summary: "run the doors learner for the session named, as the friction drain does (the tool server's friction_drain runs it)",
    async act(args, context) {
      const session = args.text("session");
      if (session === undefined) throw new Refusal(`--session names the session the learner runs for\nusage: storytree ${learnUsage}`, { code: 2 });
      const harness = args.text("harness");
      const [{ surfaces }, drain] = await Promise.all([import("./index.js"), run === undefined ? import("./drain.js") : { learn: run }]);
      const said = await drain.learn(context, surfaces, { caller: { session, ...(harness === undefined ? {} : { harness }) }, writer: { actor: `session:${session}` } });
      return { text: said.join("\n") };
    },
  };
}

export const doors: Family = {
  name: "doors",
  summary: "how the command line and the tools are used; `doors learn` runs the doors learner",
  verbs: [learner()],
  bare: read,
};

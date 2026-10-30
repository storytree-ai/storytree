/**
 * Capability 11 · Machines. The machine verbs, declared once (ADR-0969 D2): give this computer its short name, list the
 * project's machines, and say which one this computer is. They are the command line's: a computer is named by the
 * person at it, and an agent has no use for the list until an increment names a machine.
 */
import { verb, VerbRefusal, type Verb, type VerbContext, type VerbInputs, type VerbPlace } from "@storytree/library/verbs";

import type { MachineReadings } from "./health.js";
import type { MachineRecord } from "./machines.js";

const NO_TOOL = { absent: "a computer is named, and its machines read, by the person at it on the command line" };

/** The library server the machines are kept on: a door that has none open cannot reach them. */
function server(context: VerbContext) {
  if (context.server === undefined) throw new VerbRefusal("the machines are kept on the library server, which this door has not opened");
  return context.server;
}

/** Where the caller's computer keeps its storytree home, when the context names one. */
function here(context: VerbContext) {
  return context.home === undefined ? {} : { home: context.home };
}

function described(machine: MachineRecord): string {
  return `hostname ${machine.hostname}, id ${machine.id}`;
}

const name = verb({
  command: { family: "machine", name: "name", summary: "give this computer a short name (laptop, mint): what people and increments call it" },
  tool: NO_TOOL,
  inputs: { name: { kind: "text", word: 0, describe: "a short name: lowercase letters, digits and hyphens" } },
  async act({ name: given }, context) {
    const { MachineNameError, nameThisMachine } = await import("./machines.js");
    try {
      const machine = await nameThisMachine(server(context), given, here(context));
      return { text: `Named this computer "${machine.name}" (${described(machine)}).`, data: { ...machine } };
    } catch (error) {
      if (error instanceof MachineNameError) throw new VerbRefusal(error.message, { misuse: error.misuse });
      throw error;
    }
  },
});

const list = verb({
  command: { family: "machine", name: "list", summary: "the computers that work on this project, each with its name, hostname and id" },
  tool: NO_TOOL,
  inputs: {},
  async act(_input, context) {
    const { machinesOf } = await import("./machines.js");
    const machines = await machinesOf(server(context), context.project, here(context));
    const lines = machines.map((machine) => `${machine.name ?? "(no name)"}  ${machine.hostname}  ${machine.id}${machine.here ? "  (this computer)" : ""}`);
    return {
      text: [`${machines.length} machine${machines.length === 1 ? "" : "s"}: name, hostname, id.`, ...lines].join("\n"),
      data: { machines },
      next: [{ command: "machine name <name>", why: "give this computer its short name" }],
    };
  },
});

const which = verb({
  command: { family: "machine", name: "this", summary: "which machine this computer is: its name, hostname and id" },
  tool: NO_TOOL,
  inputs: {},
  async act(_input, context, words) {
    const { thisComputer } = await import("./machines.js");
    const machine = await thisComputer(server(context), here(context));
    return {
      text: machine.name === undefined
        ? `This computer has no name yet (${described(machine)}): give it one with ${words.say({ command: "machine name <name>" })}.`
        : `This computer is "${machine.name}" (${described(machine)}).`,
      data: { ...machine },
    };
  },
});

/** Where `machine health` is called: the place alone, and the storytree home whose settings hold its limits. */
export type HealthPlace = VerbPlace & { readonly home?: string };

/**
 * `storytree machine health`, reading the machine `read` gives (this one, unless a test hands its own) against the
 * limits in the settings of `home`. It needs no library, so it answers on a machine whose library is out of reach; a
 * concern is its "no", so the command exits 1 and a script over SSH can tell.
 */
export function healthVerb(read?: () => MachineReadings): Verb<VerbInputs, HealthPlace> {
  return verb({
    command: { family: "machine", name: "health", summary: "this machine's health: its uptime, memory, load and disk, concerns first; exits 1 on a concern" },
    tool: NO_TOOL,
    inputs: {},
    callerless: true,
    async act(_input, context: HealthPlace) {
      const { readSettings } = await import("@storytree/project-and-caller");
      const { concernsOf, healthSaid, thisMachine } = await import("./health.js");
      const settings = readSettings(context.home);
      const readings = (read ?? thisMachine)();
      const concerns = concernsOf(readings, { memoryGB: settings["health-memory"].value, load: settings["health-load"].value, diskPercent: settings["health-disk"].value });
      const text = healthSaid(readings, concerns);
      if (concerns.length > 0) throw new VerbRefusal(text);
      return { text, data: { ...readings, concerns } };
    },
  });
}

/** The machine verbs, in the order the command line lists them. */
export const MACHINE_VERBS: readonly Verb[] = [list, which, name, healthVerb()];

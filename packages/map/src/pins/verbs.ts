/**
 * Capability 9 · Agents' pins. The pin verbs, declared once (ADR-0969 D2) and named under `verbs` in the package's
 * manifest (ADR-1033): the command line mounts them as its `pin` family and the MCP server as the `pin`, `pins` and
 * `retire_pin` tools. As the map's other verbs, only the library's command schema's types are read here, and its refusal
 * and the caller's imports inside the acts.
 */
import type { Library } from "@storytree/library";
import type { Verb, VerbContext, VerbFamily, VerbInputs } from "@storytree/library/verbs";
import type { ImportedFolder } from "../code-survey/read-survey.js";

import { PIN_CAP, PIN_ICON_NAMES, type PinIcon, type PinShelf, type PinWorld } from "./pins.js";

const ANCHOR = "<capability>[/<part folder>][#<exported name>], or store:<address>[#<table>]";

async function refuse(message: string, misuse = false): Promise<never> {
  const { VerbRefusal } = await import("@storytree/library/verbs");
  throw new VerbRefusal(message, { misuse });
}

/** The library's pin records, as the pins read and write them. */
function shelfOf(library: Library, context: VerbContext): PinShelf {
  return {
    list: () => library.list("pin"),
    record: (pin) => library.recordPin(pin, context.writer),
    get: (id) => library.get(id),
    retire: (id, reason) => library.retire(id, reason, context.writer),
  };
}

/** A pin verb's context: a door may hand the world the pins are read against; left out, the current checkout's is read. */
export interface PinVerbContext extends VerbContext {
  readonly pinWorld?: () => Promise<PinWorld>;
}

/** The current checkout's plan, survey and stores, which every pin is read against. */
async function worldOf(context: PinVerbContext): Promise<PinWorld> {
  if (context.pinWorld !== undefined) return context.pinWorld();
  const [{ pinWorldAt }, { importsOf, machineOf, storytreeHome }] = await Promise.all([import("../read.js"), import("@storytree/project-and-caller")]);
  if (context.server === undefined) throw new Error("the pins read this machine's imports from the library server, which this door did not open");
  const imports: readonly ImportedFolder[] = await importsOf(context.server, context.library.name, machineOf(storytreeHome()).id);
  return pinWorldAt(context.library, context.folder, imports);
}

/** The commit a pin was checked at: the one given, else the checkout at `folder`'s HEAD; undefined when Git cannot say. */
export async function checkedAt(commit: string | undefined, folder: string): Promise<string | undefined> {
  if (commit !== undefined) return commit;
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => execFile("git", ["rev-parse", "HEAD"], { cwd: folder }, (error, stdout) => resolve(error ? undefined : stdout.trim())));
}

const newInputs = {
  on: { kind: "text", word: 0, describe: `what it is pinned on: ${ANCHOR}` },
  icon: { kind: "text", describe: `what was found, as one of ${PIN_ICON_NAMES.join(", ")}` },
  label: { kind: "text", describe: "a short label, 40 characters or fewer" },
  evidence: { kind: "text", describe: "what shows it: the file and line, and what they say" },
  commit: { kind: "text", optional: true, describe: "the commit it was checked at; the checkout's HEAD when left out" },
} as const;

const pinNew: Verb<typeof newInputs, PinVerbContext> = {
  command: {
    family: "pin",
    name: "new",
    summary: `pin what you found on the map, with its evidence, at most ${PIN_CAP} on one place`,
    usage: `pin new <${ANCHOR}> --icon <icon> --label <text> --evidence <text> [--commit <sha>]`,
  },
  tool: {
    name: "pin",
    description: `Pin what you found on the map so it lasts: a cache, a queue, an API, found inside a capability, maybe nested several parts deep. Anchor it on a capability id, a nested part of it by the part's folder as the map names it (capability_x/packages/web/src/cache), or an exported name in either (#name); a shared store (a database, a Redis) is pinned on the stores' drawing instead, as store:<address>, optionally #<table>. Give one of the preset icons (${PIN_ICON_NAMES.join(", ")}), a short label, and the evidence (file, line, what it says); it records the commit it was checked at. The map shows it on the deepest part drawn and rolls it up to the parent when zoomed out; it reads stale once its anchor no longer resolves. At most ${PIN_CAP} pins on one place: retire one with retire_pin first.`,
  },
  inputs: newInputs,
  async act(input, context) {
    const { parseAnchor, writePin } = await import("./pins.js");
    const anchor = parseAnchor(input.on);
    if (anchor === undefined) return refuse(`Name what to pin on: ${ANCHOR}.`, true);
    if (!(PIN_ICON_NAMES as readonly string[]).includes(input.icon)) return refuse(`The icon is one of ${PIN_ICON_NAMES.join(", ")}.`, true);
    const commit = await checkedAt(input.commit, context.folder);
    if (commit === undefined) return refuse("Give the commit it was checked at: --commit <sha>; this folder's Git cannot say.", true);
    const written = await writePin(shelfOf(context.library, context), await worldOf(context), { anchor, icon: input.icon as PinIcon, label: input.label, evidence: input.evidence, commit });
    if (!written.ok) return refuse(written.refused);
    return { text: `Pinned ${written.pin.id} [${input.icon}] "${input.label}" on ${input.on.trim()}, checked at ${commit.slice(0, 12)}.`, data: { id: written.pin.id } };
  },
};

const listInputs = { stale: { kind: "switch", describe: "only the pins whose anchor no longer resolves" } } as const;

const pinList: Verb<typeof listInputs, PinVerbContext> = {
  command: { family: "pin", name: "list", summary: "every pin on the map, each live or stale against this checkout", usage: "pin list [--stale]" },
  tool: {
    name: "pins",
    description: "List the pins agents left on the map, each with its icon, label, anchor, the commit it was checked at and its evidence, read against this checkout: stale, with why, once its anchor no longer resolves. Give stale for only those; retire a stale one with retire_pin.",
  },
  inputs: listInputs,
  async act(input, context) {
    const { pinLine, readPins } = await import("./pins.js");
    const read = (await readPins(shelfOf(context.library, context), await worldOf(context))).filter(({ stale }) => !input.stale || stale !== undefined);
    const stale = read.filter((one) => one.stale !== undefined).length;
    const head = read.length === 0 ? (input.stale ? "No pin is stale." : "No pins yet.") : `${read.length} pin${read.length === 1 ? "" : "s"}${input.stale ? ", all stale" : `, ${stale} stale`}:`;
    return { text: [head, ...read.map(pinLine)].join("\n"), data: { pins: read.map(({ pin, stale: why }) => ({ id: pin.id, ...pin.fields, ...(why === undefined ? {} : { stale: why }) })) } };
  },
};

const retireInputs = {
  id: { kind: "text", word: 0, describe: "the pin to retire" },
  reason: { kind: "text", describe: "why: stale, or wrong, in a few words" },
} as const;

const pinRetire: Verb<typeof retireInputs, PinVerbContext> = {
  command: { family: "pin", name: "retire", summary: "retire a pin, saying why; any agent may", usage: "pin retire <pin> --reason <text>" },
  tool: { name: "retire_pin", description: "Retire a pin from the map, saying why: any agent may, a stale one above all. Its history keeps it with your reason, and it frees its place for another." },
  inputs: retireInputs,
  async act(input, context) {
    const { retirePin } = await import("./pins.js");
    const retired = await retirePin(shelfOf(context.library, context), input.id, input.reason);
    if (!retired.ok) return refuse(retired.refused);
    return { text: `Retired ${input.id}: ${input.reason}.` };
  },
};

/** The command line's `pin` family, beside the map's. */
export const PIN_FAMILIES: readonly VerbFamily<PinVerbContext>[] = [
  { name: "pin", summary: "agents' lasting pins on the map, with their evidence: new, list, retire", order: 18, verbs: [pinNew, pinList, pinRetire] as Verb<VerbInputs, PinVerbContext>[] },
];

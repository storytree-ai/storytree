/**
 * Capability 1 · Front door. The families `storytree` answers, in the order `storytree` alone lists them: the capabilities of
 * the command line story, each a front door onto its owning story. A family its owning story declares in its manifest
 * (`#parts/verbs`, ADR-1033) is mounted from there, at the place it declares among those still kept here: listed by place,
 * not counted into a position, so a new family takes an unused place and no other's moves. A declared family whose part
 * this computer switches off (ADR-1095) stays in the table, so asking for it is answered with how to switch it on, unless
 * a plugin in this computer's factory folder stands in for that part: then the plugin's families are mounted in its place.
 */
import composed from "#parts/verbs";
import { readPartsOff, readStandIns } from "@storytree/project-and-caller";
import { mount, standIn, type SwitchedOff } from "@storytree/plugin-loader";
import { standInPlaces } from "@storytree/plugin-loader/switch";

import type { Family } from "../door.js";
import { family as mounted } from "../mount.js";
import { auth } from "./auth.js";
import { capabilities } from "./capability.js";
import { contracts } from "./contract.js";
import { commandsOf, doors } from "./doors.js";
import { learning, twinsOf } from "./drain.js";
import { plan } from "./plan.js";
import { tree } from "./tree.js";

/**
 * Words agents try for a family storytree does not have, each with the command for that job. A key of two words is the
 * word with the one after it, which names the job more exactly than the word alone and is named before it.
 */
export const GUESSES: Readonly<Record<string, string>> = {
  claim: "workspace <increment|capability> --reason <text>",
  board: "noticeboard",
  story: "tree [<story>]",
};

/**
 * Words agents guess for a job a command already does, keyed by the words after `storytree`, each with that command:
 * the door runs it with the words after them and says so (ADR-1090 D1, the hand-written ADR-1045 D4 pointer).
 */
export const POINTERS: Readonly<Record<string, string>> = {
  "adr show": "adr pull",
  wait: "arc increment wait",
  "friction list": "library list friction",
  "library open": "library read",
  "capability show": "library read",
  "arc increment show": "library read",
  "plan show": "plan",
  "contract new": "library new contract",
  "contract health": "contract show",
};

/** The families still kept here, each at the place it takes among the declared ones in `storytree`'s list. */
const KEPT: readonly Placed[] = [
  { order: 6, family: doors },
  { order: 15, family: tree },
  { order: 15.5, family: plan },
  { order: 19, family: capabilities },
  { order: 19.5, family: contracts },
  { order: 32, family: auth },
];

/**
 * The declared families this command mounts, each with its part: those of storytree's own parts, but a part a factory
 * plugin stands in for while it is off (its families giving way to the plugin's), and the stand-ins' own, a plugin that
 * adds a part of its own among them while the setting names it. A settings file
 * that cannot be read mounts storytree's own alone, and the command that reads it next says why.
 */
const declared = (() => {
  let off: readonly string[];
  let standIns: ReturnType<typeof readStandIns>;
  try {
    off = readPartsOff();
    standIns = readStandIns();
  } catch {
    return composed;
  }
  const loaded = standIn(composed, "verbs", standIns);
  const places = standInPlaces(loaded.graph, off);
  const standsIn = loaded.standsIn ?? {};
  const standing = new Set(loaded.owners.filter((owner) => Object.hasOwn(standsIn, owner) && places.has(standsIn[owner]!)));
  const replaced = new Set([...standing].map((plugin) => standsIn[plugin]!));
  const keep = loaded.owners.map((owner) => Object.hasOwn(standsIn, owner) ? standing.has(owner) : !replaced.has(owner));
  return { ...loaded, parts: loaded.parts.filter((_, at) => keep[at]), owners: loaded.owners.filter((_, at) => keep[at]) };
})();

export const FAMILIES: readonly Family[] = inOrder([...KEPT, ...declared.parts.map((family) => ({ order: family.order, family: learning(mounted(family), surfaces) }))]);

/** The family that switches a part back on, mounted whatever is off, so the way back is never switched off with its part. */
const WAY_BACK = "settings";

/**
 * Each declared family a switched-off part declares, by name, with why, when the setting names `off` (ADR-1095); a
 * factory plugin standing in is mounted, never off, and a stand-in that could not be loaded is said with its part.
 */
export function familiesOff(off: readonly string[]): ReadonlyMap<string, SwitchedOff> {
  const said = new Map(mount(declared, off).off.map((one) => [one.part, one]));
  return new Map(declared.parts.flatMap((family, index) => {
    const part = declared.owners[index]!;
    const switched = said.get(part);
    return switched === undefined || family.name === WAY_BACK ? [] : [[family.name, { ...switched, part }] as const];
  }));
}

/** A family and the place it takes in `storytree`'s list: any number, so a place between two others shifts neither. */
export interface Placed {
  readonly order: number;
  readonly family: Family;
}

/** The families in ascending order of their places, those sharing one by name. */
export function inOrder(placed: readonly Placed[]): Family[] {
  return [...placed].sort((a, b) => a.order - b.order || a.family.name.localeCompare(b.family.name)).map(({ family }) => family);
}

/** The surfaces the doors learner judges in the friction drain: every command, every tool served in `cwd`, and the verbs both mount. */
export async function surfaces(cwd: string) {
  const { servedTools } = await import("@storytree/mcp-server");
  const tools = (await servedTools(cwd)).map(({ name, consumers }) => ({ verb: name, consumers }));
  return { commands: commandsOf(FAMILIES), tools, twins: twinsOf(declared.parts) };
}

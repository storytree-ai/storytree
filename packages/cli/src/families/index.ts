// Capability 1 · Front door
import composed from "#parts/verbs";
import { readPartsOff, readStandIns } from "@storytree/project-and-caller";
import { mount, standIn, type SwitchedOff } from "@storytree/plugin-loader";
import { pluginAt, standInPlaces } from "@storytree/plugin-loader/switch";

import type { Family } from "../door.js";
import { family as mounted } from "../mount.js";
import { auth } from "./auth.js";
import { capabilities } from "./capability.js";
import { contracts } from "./contract.js";
import { commandsOf, doors } from "./doors.js";
import { learning, twinsOf } from "./drain.js";
import { plan } from "./plan.js";
import { tree } from "./tree.js";

export const GUESSES: Readonly<Record<string, string>> = {
  claim: "workspace <increment|capability> --reason <text>",
  board: "noticeboard",
  story: "tree [<story>]",
  sessions: "session list",
  machines: "machine list",
};

export const POINTERS: Readonly<Record<string, string>> = {
  "adr show": "adr pull",
  wait: "arc increment wait",
  "file-owners": "workspace owners",
  "friction list": "library list friction",
  "library open": "library read",
  "capability show": "library read",
  "arc increment show": "library read",
  "plan show": "plan",
  "contract new": "library new contract",
  "contract health": "contract show",
  "story show": "tree",
  "story list": "library list story",
  "resteer list": "library list resteer",
};

export const NO_SUCH_JOB: Readonly<Record<string, { why: string; instead: string }>> = {
  "arc close": {
    why: "an arc has no close of its own: it reads closed once none of its increments is open and none of its questions waits, so it closes when its last increment does",
    instead: "arc increment close",
  },
  "auth get": {
    why: "storytree never prints a key's value: a key is a person's own, given at a terminal, and `storytree auth list` names each key and where it resolves from",
    instead: "auth list",
  },
};

const KEPT: readonly Placed[] = [
  { order: 6, family: doors },
  { order: 15, family: tree },
  { order: 15.5, family: plan },
  { order: 19, family: capabilities },
  { order: 19.5, family: contracts },
  { order: 32, family: auth },
];

function declaredIn(home?: string) {
  let off: readonly string[];
  let standIns: ReturnType<typeof readStandIns>;
  try {
    off = readPartsOff(home);
    standIns = readStandIns(home);
  } catch {
    return composed;
  }
  const loaded = standIn(composed, "verbs", standIns);
  const places = standInPlaces(loaded.graph, off);
  const standsIn = loaded.standsIn ?? {};
  const from = loaded.owners.map((_, at) => pluginAt(loaded, at));
  const standing = new Set(from.filter((plugin) => plugin !== undefined && places.has(standsIn[plugin]!)));
  const replaced = new Set([...standing].map((plugin) => standsIn[plugin!]!));
  const keep = loaded.owners.map((owner, at) => from[at] !== undefined ? standing.has(from[at]) : !replaced.has(owner));
  const kept = <T>(list: readonly T[]) => list.filter((_, at) => keep[at]);
  return { ...loaded, parts: kept(loaded.parts), owners: kept(loaded.owners), fromPlugin: kept(from) };
}

export function familiesIn(home?: string): readonly Family[] {
  return familiesOf(home === undefined ? declared : declaredIn(home));
}

function familiesOf(mounting: ReturnType<typeof declaredIn>): Family[] {
  return inOrder([...KEPT, ...mounting.parts.map((family) => ({ order: family.order, family: learning(mounted(family), surfaces) }))]);
}

const declared = declaredIn();

export const FAMILIES: readonly Family[] = familiesOf(declared);

const WAY_BACK = "settings";

export function familiesOff(off: readonly string[]): ReadonlyMap<string, SwitchedOff> {
  const said = new Map(mount(declared, off).off.map((one) => [one.part, one]));
  return new Map(declared.parts.flatMap((family, index) => {
    const part = declared.owners[index]!;
    const switched = pluginAt(declared, index) === undefined ? said.get(part) : undefined;
    return switched === undefined || family.name === WAY_BACK ? [] : [[family.name, { ...switched, part }] as const];
  }));
}

export interface Placed {
  readonly order: number;
  readonly family: Family;
}

export function inOrder(placed: readonly Placed[]): Family[] {
  return [...placed].sort((a, b) => a.order - b.order || a.family.name.localeCompare(b.family.name)).map(({ family }) => family);
}

export async function surfaces(cwd: string) {
  const { servedTools } = await import("@storytree/mcp-server");
  const tools = (await servedTools(cwd)).map(({ name, consumers }) => ({ verb: name, consumers }));
  return { commands: commandsOf(FAMILIES), tools, twins: twinsOf(declared.parts) };
}

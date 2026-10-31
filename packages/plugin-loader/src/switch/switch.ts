/**
 * Capability 4 · Switching a part off (ADR-1092 D2, D3; ADR-1095). A part is one of storytree's story packages with a
 * manifest, named without its scope (`forest`, `arc-surface`). A composed list carries the part each declaration came
 * from and the graph of the host's parts, so a host leaves out what this computer's setting switches off: a part named
 * off, and every part that stands on one, said to be off because of the one it stands on. The core is never left out.
 * Pure: no file reads, so the desktop's sandboxed preload may load it.
 */

/** Each of a host's parts, by name, with the parts among them its package.json depends on. */
export type PartsGraph = Readonly<Record<string, readonly string[]>>;

/** What `#parts/<kind>` gives a host: the declarations, the part each came from (in step with them), and the host's parts graph. */
export interface Composition<Part> {
  readonly parts: readonly Part[];
  readonly owners: readonly string[];
  readonly graph: PartsGraph;
  /** Each factory plugin among the owners, with the part it stands in for (capability 5): mounted only while that part is off, or, for a part the host has none of, while the setting names it. */
  readonly standsIn?: Readonly<Record<string, string>>;
  /** Each part whose named stand-in could not be loaded, with why. */
  readonly failed?: Readonly<Record<string, string>>;
}

/** A part switched off, and the part named off it is off because of: itself, or one it stands on. */
export interface SwitchedOff {
  readonly part: string;
  readonly because: string;
  /** Why the factory plugin named to stand in for it could not be loaded, when one was named and failed. */
  readonly failed?: string;
}

/** The core, which is never switched off: the loader ignores it when the setting names it (the switch refuses it). */
export const CORE: readonly string[] = ["library", "plugin-loader", "project-and-caller"];

/** A package's part name: its package name without its scope. */
export function partName(pkg: string): string {
  return pkg.replace(/^@[^/]+\//, "");
}

/**
 * Every part of `graph` switched off when `off` names parts off: each one named that the graph has (the core aside),
 * then every part standing on a switched-off one, however deep, because of the named one it reaches first.
 */
export function switchedOff(graph: PartsGraph, off: readonly string[]): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const name of off) if (Object.hasOwn(graph, name) && !CORE.includes(name)) found.set(name, name);
  for (let grew = true; grew;) {
    grew = false;
    for (const [part, standsOn] of Object.entries(graph)) {
      if (found.has(part) || CORE.includes(part)) continue;
      const under = standsOn.find((one) => found.has(one));
      if (under === undefined) continue;
      found.set(part, found.get(under)!);
      grew = true;
    }
  }
  return found;
}

/**
 * The parts a factory plugin named for one is mounted for when `off` names parts off: each part of `graph` switched off,
 * and each part `off` names that `graph` lacks (the core aside), one that has left the base, such as voice, or one a
 * factory plugin adds, standing in for no part of storytree's (capability 5).
 */
export function standInPlaces(graph: PartsGraph, off: readonly string[]): ReadonlySet<string> {
  return new Set([...switchedOff(graph, off).keys(), ...off.filter((part) => !Object.hasOwn(graph, part) && !CORE.includes(part))]);
}

/**
 * The declarations of `composition` a host mounts when `off` names parts off, and each part it left out with why: a
 * factory plugin's stand in for its part only while that part is off, or while the setting names it off when no part of
 * the host is called that.
 */
export function mount<Part>(composition: Composition<Part>, off: readonly string[]): { mounted: Part[]; off: SwitchedOff[] } {
  const switched = switchedOff(composition.graph, off);
  const places = standInPlaces(composition.graph, off);
  const standsIn = composition.standsIn ?? {};
  const failed = composition.failed ?? {};
  return {
    mounted: composition.parts.filter((_, index) => {
      const owner = composition.owners[index]!;
      return Object.hasOwn(standsIn, owner) ? places.has(standsIn[owner]!) : !switched.has(owner);
    }),
    off: [...switched].map(([part, because]) => ({ part, because, ...(Object.hasOwn(failed, part) ? { failed: failed[part]! } : {}) }))
      .sort((a, b) => a.part.localeCompare(b.part)),
  };
}

/** What a host says when something a switched-off part adds is asked for: that it is off, why, and how to switch it on. */
export function offSaid({ part, because, failed }: SwitchedOff): string {
  const why = because === part ? "" : ` because ${because}, which it stands on, is off`;
  const standIn = failed === undefined ? "" : `, and ${failed}`;
  return `${part} is switched off on this computer${why}${standIn}. Switch it on with: storytree settings set part ${because} on`;
}

/** A declared verb, as far as what it provides: its command, with a name unless it is absent, and its tool, likewise. */
export interface ProvidingVerb {
  readonly command: object;
  readonly tool: object;
}

/** A command's or tool's name, none when it is declared absent. */
const nameOf = (face: object): string | undefined => "name" in face && typeof face.name === "string" ? face.name : undefined;

/** A declared command family, as far as what it provides: its verbs, its bare verb and the families within it. */
export interface ProvidingFamily {
  readonly name: string;
  readonly verbs: readonly ProvidingVerb[];
  readonly bare?: ProvidingVerb;
  readonly families?: readonly ProvidingFamily[];
}

/** What declared command families provide: the families, each command by the words after `storytree`, and each tool. */
export interface Provided {
  readonly families: readonly string[];
  readonly commands: readonly string[];
  readonly tools: readonly string[];
}

/** The commands and tools of `family`, whose words after `storytree` are `words`, its bare verb's and its nested families' included. */
function faces(family: ProvidingFamily, words: string): { commands: string[]; tools: string[] } {
  const verbs = [...(family.bare === undefined ? [] : [{ verb: family.bare, words }]), ...family.verbs.map((verb) => ({ verb, words: `${words} ${nameOf(verb.command)}` }))];
  const nested = (family.families ?? []).map((within) => faces(within, `${words} ${within.name}`));
  return {
    commands: [...verbs.flatMap(({ verb, words: said }) => nameOf(verb.command) === undefined ? [] : [said]), ...nested.flatMap((one) => one.commands)],
    tools: [...verbs.flatMap(({ verb }) => nameOf(verb.tool) ?? []), ...nested.flatMap((one) => one.tools)],
  };
}

/** What `families` provide, in the order they declare it. */
export function provided(families: readonly ProvidingFamily[]): Provided {
  const each = families.map((family) => faces(family, family.name));
  return { families: families.map((family) => family.name), commands: each.flatMap((one) => one.commands), tools: each.flatMap((one) => one.tools) };
}

/** What `part` provides of the command families `composition` composed: those it declares. */
export function partProvides(composition: Composition<ProvidingFamily>, part: string): Provided {
  return provided(composition.parts.filter((_, index) => composition.owners[index] === part));
}

const listed = (one: string, many: string, names: readonly string[]): string => `${names.length === 1 ? one : many} ${names.join(", ")}`;

/** What `provides` names, in words: "the command family health: health worklist, health ci; and the tool health_worklist". */
export function providedSaid({ families, commands, tools }: Provided): string {
  if (families.length === 0) return "nothing of the command line or the MCP server's";
  const family = `${listed("the command family", "the command families", families)}${commands.length === 0 ? "" : `: ${commands.join(", ")}`}`;
  return tools.length === 0 ? family : `${family}; and ${listed("the tool", "the tools", tools)}`;
}

/** What a stand-in providing `has` lacks of what its part provides, `part`, in words, or undefined when it lacks nothing. */
export function lackingSaid(part: Provided, has: Provided): string | undefined {
  const commands = part.commands.filter((command) => !has.commands.includes(command));
  const tools = part.tools.filter((tool) => !has.tools.includes(tool));
  const said = [...(commands.length === 0 ? [] : [listed("the command", "the commands", commands)]), ...(tools.length === 0 ? [] : [listed("the tool", "the tools", tools)])];
  return said.length === 0 ? undefined : said.join("; and ");
}

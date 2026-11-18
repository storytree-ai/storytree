// Capability 4 · Switching a module off

export type PartsGraph = Readonly<Record<string, readonly string[]>>;

export interface Composition<Part> {
  readonly parts: readonly Part[];
  readonly owners: readonly string[];
  readonly graph: PartsGraph;
  readonly standsIn?: Readonly<Record<string, string>>;
  readonly fromPlugin?: readonly (string | undefined)[];
  readonly failed?: Readonly<Record<string, string>>;
}

export interface SwitchedOff {
  readonly part: string;
  readonly because: string;
  readonly failed?: string;
}

export const CORE: readonly string[] = ["library", "plugin-loader", "project-and-caller"];

export function partName(pkg: string): string {
  return pkg.replace(/^@[^/]+\//, "");
}

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

export function standInPlaces(graph: PartsGraph, off: readonly string[]): ReadonlySet<string> {
  return new Set([...switchedOff(graph, off).keys(), ...off.filter((part) => !Object.hasOwn(graph, part) && !CORE.includes(part))]);
}

export function pluginAt(composition: Composition<unknown>, index: number): string | undefined {
  if (composition.fromPlugin !== undefined) return composition.fromPlugin[index];
  const owner = composition.owners[index]!;
  return Object.hasOwn(composition.standsIn ?? {}, owner) ? owner : undefined;
}

export function mount<Part>(composition: Composition<Part>, off: readonly string[]): { mounted: Part[]; off: SwitchedOff[] } {
  const switched = switchedOff(composition.graph, off);
  const places = standInPlaces(composition.graph, off);
  const standsIn = composition.standsIn ?? {};
  const failed = composition.failed ?? {};
  return {
    mounted: composition.parts.filter((_, index) => {
      const plugin = pluginAt(composition, index);
      return plugin !== undefined ? places.has(standsIn[plugin]!) : !switched.has(composition.owners[index]!);
    }),
    off: [...switched].map(([part, because]) => ({ part, because, ...(Object.hasOwn(failed, part) ? { failed: failed[part]! } : {}) }))
      .sort((a, b) => a.part.localeCompare(b.part)),
  };
}

export function offSaid({ part, because, failed }: SwitchedOff): string {
  const why = because === part ? "" : ` because ${because}, which it stands on, is off`;
  const standIn = failed === undefined ? "" : `, and ${failed}`;
  return `${part} is switched off on this computer${why}${standIn}. Switch it on with: storytree settings set module ${because} on`;
}

export interface ProvidingVerb {
  readonly command: object;
  readonly tool: object;
}

const nameOf = (face: object): string | undefined => "name" in face && typeof face.name === "string" ? face.name : undefined;

export interface ProvidingFamily {
  readonly name: string;
  readonly verbs: readonly ProvidingVerb[];
  readonly bare?: ProvidingVerb;
  readonly families?: readonly ProvidingFamily[];
}

export interface Provided {
  readonly families: readonly string[];
  readonly commands: readonly string[];
  readonly tools: readonly string[];
}

function faces(family: ProvidingFamily, words: string): { commands: string[]; tools: string[] } {
  const verbs = [...(family.bare === undefined ? [] : [{ verb: family.bare, words }]), ...family.verbs.map((verb) => ({ verb, words: `${words} ${nameOf(verb.command)}` }))];
  const nested = (family.families ?? []).map((within) => faces(within, `${words} ${within.name}`));
  return {
    commands: [...verbs.flatMap(({ verb, words: said }) => nameOf(verb.command) === undefined ? [] : [said]), ...nested.flatMap((one) => one.commands)],
    tools: [...verbs.flatMap(({ verb }) => nameOf(verb.tool) ?? []), ...nested.flatMap((one) => one.tools)],
  };
}

export function provided(families: readonly ProvidingFamily[]): Provided {
  const each = families.map((family) => faces(family, family.name));
  return { families: families.map((family) => family.name), commands: each.flatMap((one) => one.commands), tools: each.flatMap((one) => one.tools) };
}

export function partProvides(composition: Composition<ProvidingFamily>, part: string): Provided {
  return provided(composition.parts.filter((_, index) => composition.owners[index] === part && pluginAt(composition, index) === undefined));
}

export function pluginProvides(composition: Composition<ProvidingFamily>, plugin: string): Provided {
  return provided(composition.parts.filter((_, index) => pluginAt(composition, index) === plugin));
}

const listed = (one: string, many: string, names: readonly string[]): string => `${names.length === 1 ? one : many} ${names.join(", ")}`;

export function providedSaid({ families, commands, tools }: Provided): string {
  if (families.length === 0) return "nothing of the command line or the MCP server's";
  const family = `${listed("the command family", "the command families", families)}${commands.length === 0 ? "" : `: ${commands.join(", ")}`}`;
  return tools.length === 0 ? family : `${family}; and ${listed("the tool", "the tools", tools)}`;
}

export function lackingSaid(part: Provided, has: Provided): string | undefined {
  const commands = part.commands.filter((command) => !has.commands.includes(command));
  const tools = part.tools.filter((tool) => !has.tools.includes(tool));
  const said = [...(commands.length === 0 ? [] : [listed("the command", "the commands", commands)]), ...(tools.length === 0 ? [] : [listed("the tool", "the tools", tools)])];
  return said.length === 0 ? undefined : said.join("; and ");
}

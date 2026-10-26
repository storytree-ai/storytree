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
  /** Each factory plugin among the owners, with the part it stands in for (capability 5): mounted only while that part is off. */
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
 * The declarations of `composition` a host mounts when `off` names parts off, and each part it left out with why: a
 * factory plugin's stand in for its part only while that part is off.
 */
export function mount<Part>(composition: Composition<Part>, off: readonly string[]): { mounted: Part[]; off: SwitchedOff[] } {
  const switched = switchedOff(composition.graph, off);
  const standsIn = composition.standsIn ?? {};
  const failed = composition.failed ?? {};
  return {
    mounted: composition.parts.filter((_, index) => {
      const owner = composition.owners[index]!;
      return Object.hasOwn(standsIn, owner) ? switched.has(standsIn[owner]!) : !switched.has(owner);
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

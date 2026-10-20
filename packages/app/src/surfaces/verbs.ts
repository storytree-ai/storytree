/**
 * Capability 3 · Surfaces. `storytree settings show` and `settings set`, declared once (ADR-0969 D2, ADR-1033): each of the
 * user's settings, where the library lives, and the app's surfaces (3.7), shown and set offline. They need no caller. The
 * surfaces are the host's, composed from its story packages' manifests (ADR-0750, ADR-1021), so the door hands them on its
 * place. So are its parts (ADR-1095): `settings set part` switches one off or on for this computer, which every host reads
 * as it starts. The command line mounts them as its `settings` family (SETTINGS_FAMILIES); they have no tool.
 */
import { verb, VerbRefusal, type VerbFamily, type VerbPlace } from "@storytree/library/verbs";
import { CORE, switchedOff, type PartsGraph } from "@storytree/plugin-loader";

import type { SurfaceDeclaration, SurfaceReading } from "./switches.js";

/** Where a settings verb was called: the place, the host's surfaces, in the order the Surfaces menu lists them, and its parts. */
export interface SettingsPlace extends VerbPlace {
  surfaces(): Promise<readonly SurfaceDeclaration[]>;
  parts(): Promise<PartsGraph>;
}

const NEXT = [{ command: "settings show", why: "read your settings" }] as const;

const show = verb({
  consumers: ["user"],
  command: { family: "settings", name: "show", summary: "show each setting's value, type, default and meaning" },
  tool: { absent: "the user's settings are the person's own, read from a terminal" },
  inputs: {},
  callerless: true,
  async act(_input, { surfaces, parts }: SettingsPlace) {
    const { readPartsOff, readSettings } = await import("@storytree/project-and-caller");
    const { readSurfaces } = await import("./switches.js");
    const read = readSettings();
    const settings = Object.values(read).map((reading) => reading.name === "library" ? librarySaid(reading) : settingSaid(reading)).join("\n\n");
    return { text: `${settings}\n\n${surfacesSaid(readSurfaces(await surfaces()))}\n\n${partsSaid(await parts(), readPartsOff())}` };
  },
});

const set = verb({
  consumers: ["user"],
  command: {
    family: "settings",
    name: "set",
    summary: "save a setting for your user account",
    usage: "settings set <name> <value> | settings set library <local | cloudsql <instance> <user> | postgres <address>> | settings set surface <surface> <on | off | <setting> <choice>> | settings set part <part> <on | off>",
  },
  tool: { absent: "the user's settings are the person's own, set from a terminal" },
  inputs: { words: { kind: "text", word: 0, many: true, describe: "the setting's name and its value" } },
  callerless: true,
  async act({ words }, { surfaces, parts }: SettingsPlace) {
    const { setLibrary, setPartOff, setSetting } = await import("@storytree/project-and-caller");
    if (words[0] === "library" && words.length >= 2) return { text: librarySaid(setLibrary(words.slice(1))), next: NEXT };
    if (words[0] === "part" && words.length === 3) {
      const [, part, state] = words as [string, string, string];
      if (state !== "on" && state !== "off") throw new VerbRefusal(`a part is switched on or off, not ${JSON.stringify(state)}`, { misuse: true });
      const graph = await parts();
      if (!CORE.includes(part) && !Object.hasOwn(graph, part)) throw new VerbRefusal(`there is no part called ${part} here. Parts: ${switchable(graph).join(", ")}.`);
      return { text: switchedSaid(graph, setPartOff(part, state === "off")), next: NEXT };
    }
    if (words[0] === "surface" && words.length >= 3) {
      const { setSurface } = await import("./switches.js");
      const surface = setSurface(await surfaces(), words.slice(1)).find((each) => each.id === words[1])!;
      return { text: surfaceSaid(surface, ""), next: NEXT };
    }
    if (words.length !== 2) throw new VerbRefusal(`this takes a setting's name and its value, and was given ${words.length} word${words.length === 1 ? "" : "s"}`, { misuse: true });
    return { text: settingSaid(setSetting(words[0]!, words[1]!)), next: NEXT };
  },
});

/** The command line's `settings` family, at its place among `storytree`'s families. */
export const SETTINGS_FAMILIES: readonly VerbFamily<SettingsPlace>[] = [
  { name: "settings", summary: "show or set your storytree settings", order: 25, verbs: [show, set] },
];

/** A setting as Project and caller reads it, other than where the library lives: this story's own copy of what it says (ADR-1017 D2). */
type SettingReading = {
  readonly name: string;
  readonly type: string;
  readonly unit: string;
  readonly default: string | number;
  readonly meaning: string;
  readonly value: string | number;
  readonly source: "default" | "set";
};

/** Where the library lives, as Project and caller reads it: this story's own copy of what it says (ADR-1017 D2). */
type LibraryReading = (
  | { readonly location: "local" }
  | { readonly location: "cloudsql"; readonly instance: string; readonly user: string }
  | { readonly location: "postgres"; readonly address: string }
) & { readonly default: string; readonly meaning: string; readonly source: "default" | "set" };

function settingSaid(reading: SettingReading): string {
  const unit = reading.unit === "" ? "" : ` ${reading.unit}`;
  return `${reading.name}: ${reading.value}${unit} (${reading.source})\n`
    + `  Type: ${reading.type}; default: ${reading.default}${unit}.\n  ${reading.meaning}`;
}

function librarySaid(reading: LibraryReading): string {
  const where = reading.location === "cloudsql" ? `cloudsql ${reading.instance} as ${reading.user}`
    : reading.location === "postgres" ? `postgres ${reading.address} (its password the key postgres)` : "local";
  return `library: ${where} (${reading.source})\n  Default: ${reading.default}.\n  ${reading.meaning}`;
}

/** The host's parts but the core, which is never switched off. */
const switchable = (graph: PartsGraph): string[] => Object.keys(graph).filter((part) => !CORE.includes(part)).sort();

/** The parts switched off now, each that is off with another named with it, and when a host takes the change. */
function switchedSaid(graph: PartsGraph, off: readonly string[]): string {
  const switched = [...switchedOff(graph, off)].sort(([a], [b]) => a.localeCompare(b));
  const listed = switched.map(([part, because]) => because === part ? part : `${part} (with ${because}, which it stands on)`);
  const said = listed.length === 0 ? "No part is switched off on this computer." : `Switched off on this computer: ${listed.join(", ")}.`;
  return `${said}\nThe command line takes it at its next command; restart the app and your sessions' MCP servers for them to take it.`;
}

function partsSaid(graph: PartsGraph, off: readonly string[]): string {
  const switched = switchedOff(graph, off);
  const lines = Object.keys(graph).sort().map((part) => {
    const because = switched.get(part);
    const state = CORE.includes(part) ? "always on (the core)" : because === undefined ? "on" : because === part ? "off" : `off, with ${because}`;
    return `  ${part}: ${state}`;
  });
  return `Parts of storytree (switch one with \`storytree settings set part <part> on|off\`):\n${lines.join("\n")}`;
}

function surfacesSaid(surfaces: readonly SurfaceReading[]): string {
  return "Surfaces of the app (switch one with `storytree settings set surface <surface> on|off`):\n"
    + surfaces.map((surface) => surfaceSaid(surface, surface.within === undefined ? "  " : "    ")).join("\n");
}

function surfaceSaid(surface: SurfaceReading, indent: string): string {
  const state = surface.switchable ? `${surface.on ? "on" : "off"} (${surface.source})`
    : surface.follows === undefined ? "always on" : `${surface.on ? "on" : "off"}, with ${surface.follows}`;
  const settings = surface.settings.map((setting) =>
    `\n${indent}  ${setting.id}: ${setting.value} (${setting.source}); one of ${setting.choices.map((choice) => choice.id).join(", ")}. ${setting.meaning}`);
  return `${indent}${surface.name} (${surface.id}): ${state}\n${indent}  ${surface.description}${settings.join("")}`;
}

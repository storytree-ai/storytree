/**
 * Capability 3 · Surfaces. `storytree settings show` and `settings set`, declared once (ADR-0969 D2, ADR-1033): each of the
 * user's settings, where the library lives, and the app's surfaces (3.7), shown and set offline. They need no caller. The
 * surfaces are the host's, composed from its story packages' manifests (ADR-0750, ADR-1021), so the door hands them on its
 * place. So are its parts (ADR-1095): `settings set part` switches one off or on for this computer, which every host reads
 * as it starts, or off with a plugin in this computer's factory folder (`settings set factory`) standing in for it, and `settings set system` switches roles, checks and notes off or on for what agents read (ADR-1092 D2).
 * `settings set service <part>/<service>` turns a part's declared service on or off for this computer (ADR-1180 D2).
 * The command line mounts them as its `settings` family (SETTINGS_FAMILIES); they have no tool. `switch_factory` is the
 * one tool among them: an agent switches the factory folder when asked, with no approval (question_0b0b82eb8fbc).
 */
import path from "node:path";

import type { FactorySwitched } from "@storytree/project-and-caller";
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
    const { factoryFolder, partsSaid, readPartsOff, readServicesOn, readSettings, readStandIns, readSystemSwitches, servicesSaid, systemSaid } = await import("@storytree/project-and-caller");
    const { readSurfaces } = await import("./switches.js");
    const read = readSettings();
    const graph = await parts();
    const standIns = readStandIns();
    const settings = Object.values(read).map((reading) => reading.name === "library" ? librarySaid(reading) : settingSaid(reading)).join("\n\n");
    const switched = switchedHere(graph, readPartsOff());
    const listed = [...new Set([...Object.keys(graph), ...switched.keys()])];
    return { text: `${settings}\n\n${surfacesSaid(readSurfaces(await surfaces()))}\n\n${factorySaid(factoryFolder())}\n\n${partsSaid(listed, switched, standIns.plugins, standIns.switched, standIns.history, Object.keys(graph))}\n\n${systemSaid(readSystemSwitches())}\n\n${servicesSaid(readServicesOn())}` };
  },
});

/**
 * The parts `off` switches off in `graph`, each with the part it is off because of, and each part `off` names that
 * `graph` lacks: one that has left the base, such as voice, or one a factory plugin adds, in no host's parts.
 */
function switchedHere(graph: PartsGraph, off: readonly string[]): ReadonlyMap<string, string> {
  const switched = new Map(switchedOff(graph, off));
  for (const part of off) if (!Object.hasOwn(graph, part) && !CORE.includes(part)) switched.set(part, part);
  return switched;
}

const set = verb({
  consumers: ["user"],
  command: {
    family: "settings",
    name: "set",
    summary: "save a setting for your user account",
    usage: "settings set <name> <value> | settings set library <local | cloudsql <instance> <user> | postgres <address>> | settings set surface <surface> <on | off | <setting> <choice>> | settings set factory <folder> | settings set part <part> <on | off | plugin <plugin>> | settings set system <all | roles | checks | notes | <title or id>> <on | off> | settings set service <part>/<service> <on | off>",
  },
  tool: { absent: "the user's settings are the person's own, set from a terminal" },
  inputs: { words: { kind: "text", word: 0, many: true, describe: "the setting's name and its value" } },
  callerless: true,
  async act({ words }, { surfaces, parts, session }: SettingsPlace) {
    const { readStandIns, servicesSaid, setFactory, setLibrary, setSetting, switchedSaid, switchPart, switchService, switchSystem, systemSaid } = await import("@storytree/project-and-caller");
    if (words[0] === "library" && words.length >= 2) return { text: librarySaid(setLibrary(words.slice(1))), next: NEXT };
    if (words[0] === "factory" && words.length === 2) {
      const chosen = setFactory(words[1]!, undefined, { through: "command line", ...(session === undefined ? {} : { session }) });
      return { text: chosenSaid(chosen), next: NEXT };
    }
    if (words[0] === "part" && (words.length === 3 || (words.length === 4 && words[2] === "plugin"))) {
      const graph = await parts();
      const off = switchPart(words[1]!, words[2]!, Object.keys(graph), undefined, words[3], { through: "command line", ...(session === undefined ? {} : { session }) });
      return { text: switchedSaid(switchedHere(graph, off), readStandIns().plugins, Object.keys(graph)), next: NEXT };
    }
    if (words[0] === "system" && words.length === 3) return { text: systemSaid(switchSystem(words[1]!, words[2]!)), next: NEXT };
    if (words[0] === "service" && words.length === 3) return { text: servicesSaid(switchService(words[1]!, words[2]!)), next: NEXT };
    if (words[0] === "surface" && words.length >= 3) {
      const { setSurface } = await import("./switches.js");
      const surface = setSurface(await surfaces(), words.slice(1)).find((each) => each.id === words[1])!;
      return { text: surfaceSaid(surface, ""), next: NEXT };
    }
    if (words.length !== 2) throw new VerbRefusal(`this takes a setting's name and its value, and was given ${words.length} word${words.length === 1 ? "" : "s"}`, { misuse: true });
    return { text: settingSaid(setSetting(words[0]!, words[1]!)), next: NEXT };
  },
});

const switchFactory = verb({
  consumers: ["agent", "user"],
  command: { absent: "the command line switches it with `storytree settings set factory <folder>`" },
  tool: {
    name: "switch_factory",
    description:
      "Switch this computer's factory folder, the folder of the user's own plugins, to another folder, or import the user's own factory: call it when the user asks. No approval is needed. An empty folder is set up with the factory's shape, a factory is used as it is, and any other folder is refused with why. storytree records that this session switched it, and when.",
  },
  inputs: { folder: { kind: "text", describe: "The folder to use as the factory: its full path, or one relative to where you work" } },
  callerless: true,
  async act({ folder }, { folder: where, session }: VerbPlace) {
    const { setFactory } = await import("@storytree/project-and-caller");
    try {
      return { text: chosenSaid(setFactory(path.resolve(where, folder), undefined, { through: "agent tool", ...(session === undefined ? {} : { session }) })), next: NEXT };
    } catch (error) {
      throw new VerbRefusal(error instanceof Error ? error.message : String(error));
    }
  },
});

/** The command line's `settings` family, at its place among `storytree`'s families. */
export const SETTINGS_FAMILIES: readonly VerbFamily<SettingsPlace>[] = [
  { name: "settings", summary: "show or set your storytree settings", order: 25, verbs: [show, set, switchFactory] },
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

/** A factory folder just switched to: set up, or a factory already, and who switched it. */
function chosenSaid(chosen: { status: "set up" | "already a factory"; folder: string }): string {
  const how = chosen.status === "set up" ? "Set up as your factory: its plugins folder is made." : "Already a factory: kept as it was.";
  return `${how}\n${factorySaid({ folder: chosen.folder, chosen: true })}`;
}

const THROUGH: Record<FactorySwitched["through"], string> = { "desktop app": "in the desktop app", "command line": "from the command line", "agent tool": "through an agent's tool" };

/** Who switched the factory folder, and when: the record no approval stands in for. */
function switchedSaid({ through, session, at }: FactorySwitched): string {
  return `switched ${session === undefined ? "" : `by session ${session} `}${THROUGH[through]}, ${at}`;
}

/** This computer's factory folder, whose plugins may stand in for a part switched off: storytree's own, or one switched to. */
function factorySaid({ folder, chosen, switched }: { folder: string; chosen: boolean; switched?: FactorySwitched }): string {
  const said = !chosen ? `${folder} (storytree's own, the default)` : switched === undefined ? folder : `${folder} (${switchedSaid(switched)})`;
  return `factory: ${said}\n  The folder of your own factory, whose plugins (plugins/<plugin>/) may stand in for a part you switch off with \`storytree settings set part <part> plugin <plugin>\`. Choose another with \`storytree settings set factory <folder>\`.\n  What a plugin must contain: \`storytree plugin contract\`. Start one with \`storytree plugin new <plugin> --for <part>\`, and check this storytree would load it with \`storytree plugin check <plugin>\`.`;
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

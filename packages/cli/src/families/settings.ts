/** A thin front door onto the agent link's per-user settings. */
import { readSettings, setLibrary, setSetting, type LibraryReading, type SettingReading } from "@storytree/agent-link";
import { readSurfaces, setSurface, type SurfaceReading } from "@storytree/app";
import { arcSurfaces } from "@storytree/arc-surface/surfaces";
import { forestSurfaces } from "@storytree/forest/surfaces";

import { Refusal } from "../answer.js";
import type { Family } from "../door.js";

export const settings: Family = {
  name: "settings",
  summary: "show or set your storytree settings",
  verbs: [{
    name: "show",
    usage: "settings show",
    summary: "show each setting's value, type, default and meaning",
    async act(args) {
      if (args.words.length || args.names.length) throw new Refusal("usage: storytree settings show", { code: 2 });
      const read = readSettings();
      const settings = Object.values(read).map((reading) => reading.name === "library" ? librarySaid(reading) : settingSaid(reading)).join("\n\n");
      return { text: `${settings}\n\n${surfacesSaid(readSurfaces(SURFACES))}` };
    },
  }, {
    name: "set",
    usage: "settings set <name> <value> | settings set library <local | cloudsql <instance> <user> | postgres <address>> | settings set surface <surface> <on | off | <setting> <choice>>",
    summary: "save a setting for your user account",
    async act(args) {
      const usage = "settings set <name> <value>";
      if (args.words[0] === "library" && !args.names.length && args.words.length >= 2) {
        return { text: librarySaid(setLibrary(args.words.slice(1))), next: [{ command: "storytree settings show", why: "read your settings" }] };
      }
      if (args.words[0] === "surface" && !args.names.length && args.words.length >= 3) {
        const id = args.words[1];
        const surface = setSurface(SURFACES, args.words.slice(1)).find((each) => each.id === id)!;
        return { text: surfaceSaid(surface, ""), next: [{ command: "storytree settings show", why: "read your settings" }] };
      }
      if (args.words.length !== 2 || args.names.length) throw new Refusal(`usage: storytree ${usage}`, { code: 2 });
      const saved = setSetting(args.word(0, "a setting name", usage), args.word(1, "a value", usage));
      return { text: settingSaid(saved), next: [{ command: "storytree settings show", why: "read your settings" }] };
    },
  }],
};

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

/** The app's surfaces, as each story declares them (ADR-0750), in the order the Surfaces menu lists them. */
const SURFACES = [...forestSurfaces, ...arcSurfaces];

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

/** A thin front door onto the agent link's per-user settings. */
import { readSettings, setLibrary, setSetting, type LibraryReading, type SettingReading } from "@storytree/agent-link";

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
      return { text: Object.values(read).map((reading) => reading.name === "library" ? librarySaid(reading) : settingSaid(reading)).join("\n\n") };
    },
  }, {
    name: "set",
    usage: "settings set <name> <value> | settings set library <local | cloudsql <instance> <user>>",
    summary: "save a setting for your user account",
    async act(args) {
      const usage = "settings set <name> <value>";
      if (args.words[0] === "library" && !args.names.length && args.words.length >= 2) {
        return { text: librarySaid(setLibrary(args.words.slice(1))), next: [{ command: "storytree settings show", why: "read your settings" }] };
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
  const where = reading.location === "cloudsql" ? `cloudsql ${reading.instance} as ${reading.user}` : "local";
  return `library: ${where} (${reading.source})\n  Default: ${reading.default}.\n  ${reading.meaning}`;
}

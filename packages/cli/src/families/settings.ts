/** A thin front door onto the agent link's per-user settings. */
import { readSettings, setSetting, type SettingReading } from "@storytree/agent-link";

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
      return { text: Object.values(readSettings()).map(settingSaid).join("\n\n") };
    },
  }, {
    name: "set",
    usage: "settings set <name> <value>",
    summary: "save a setting for your user account",
    async act(args) {
      const usage = "settings set <name> <value>";
      if (args.words.length !== 2 || args.names.length) throw new Refusal(`usage: storytree ${usage}`, { code: 2 });
      const saved = setSetting(args.word(0, "a setting name", usage), args.word(1, "a value", usage));
      return { text: settingSaid(saved), next: [{ command: "storytree settings show", why: "read your settings" }] };
    },
  }],
};

function settingSaid(reading: SettingReading): string {
  return `${reading.name}: ${reading.value} ${reading.unit} (${reading.source})\n`
    + `  Type: ${reading.type}; default: ${reading.default} ${reading.unit}.\n  ${reading.meaning}`;
}

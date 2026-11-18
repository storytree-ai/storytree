// Capability 2 · Settings
import { VerbRefusal } from "@storytree/library/verbs";

import { storytreeHome } from "../routing/index.js";
import { setSystemSwitch, type SystemSwitches } from "./settings.js";

export function switchSystem(name: string, state: string, home: string = storytreeHome()): SystemSwitches {
  if (state !== "on" && state !== "off") throw new VerbRefusal(`the system is switched on or off, not ${JSON.stringify(state)}`, { misuse: true });
  return setSystemSwitch(name, state === "off", home);
}

export function systemSaid(switches: SystemSwitches): string {
  const head = "System of storytree (switch with `storytree settings set system <name> on|off`, the name all, roles, checks, notes, or a role's, check's or note's title or id; a record's own name beats its group, which beats all):";
  const state = switches.off.length === 0
    ? "  Nothing of storytree's system is switched off on this computer: agents read every role, check and note."
    : `  off: ${switches.off.join(", ")}${switches.on.length === 0 ? "" : `\n  on: ${switches.on.join(", ")}`}`;
  return `${head}\n${state}\n  The command line takes it at its next command; restart your sessions' MCP servers for them to take it.`;
}

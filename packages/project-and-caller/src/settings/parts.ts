/**
 * Capability 2 · Settings, contract 2.17: `settings set part <part> on|off` and the parts `settings show` lists (ADR-1092
 * D2, ADR-1095). The host hands its parts, and which of them the setting leaves off with the part each is off because
 * of: the plugin loader's reading, which only a host has, so this story reads the setting and words it without it.
 */
import { VerbRefusal } from "@storytree/library/verbs";

import { storytreeHome } from "../routing/index.js";
import { CORE, setPartOff } from "./settings.js";

/** Each part switched off, by part name, with the part it is off because of: itself, or one it stands on. */
export type PartsSwitched = ReadonlyMap<string, string>;

/**
 * Switch `part` of a host whose parts are `parts` on or off for this computer, and return the parts now named off. A
 * state but on or off, the core, and a part the host lacks are refused, saving nothing.
 */
export function switchPart(part: string, state: string, parts: readonly string[], home: string = storytreeHome()): readonly string[] {
  if (state !== "on" && state !== "off") throw new VerbRefusal(`a part is switched on or off, not ${JSON.stringify(state)}`, { misuse: true });
  if (!CORE.includes(part) && !parts.includes(part)) {
    throw new VerbRefusal(`there is no part called ${part} here. Parts: ${parts.filter((one) => !CORE.includes(one)).sort().join(", ")}.`);
  }
  return setPartOff(part, state === "off", home);
}

/** The parts switched off now, each that is off with another named with it, and when a host takes the change. */
export function switchedSaid(switched: PartsSwitched): string {
  const listed = [...switched].sort(([a], [b]) => a.localeCompare(b))
    .map(([part, because]) => because === part ? part : `${part} (with ${because}, which it stands on)`);
  const said = listed.length === 0 ? "No part is switched off on this computer." : `Switched off on this computer: ${listed.join(", ")}.`;
  return `${said}\nThe command line takes it at its next command; restart the app and your sessions' MCP servers for them to take it.`;
}

/** Each of the host's parts: on, off, off with the part it stands on, or always on (the core). */
export function partsSaid(parts: readonly string[], switched: PartsSwitched): string {
  const lines = [...parts].sort().map((part) => {
    const because = switched.get(part);
    const state = CORE.includes(part) ? "always on (the core)" : because === undefined ? "on" : because === part ? "off" : `off, with ${because}`;
    return `  ${part}: ${state}`;
  });
  return `Parts of storytree (switch one with \`storytree settings set part <part> on|off\`):\n${lines.join("\n")}`;
}

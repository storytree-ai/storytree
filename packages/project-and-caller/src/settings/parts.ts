/**
 * Capability 2 · Settings, contract 2.17: `settings set part <part> on|off` and the parts `settings show` lists (ADR-1092
 * D2, ADR-1095). The host hands its parts, and which of them the setting leaves off with the part each is off because
 * of: the plugin loader's reading, which only a host has, so this story reads the setting and words it without it.
 */
import { VerbRefusal } from "@storytree/library/verbs";

import { storytreeHome } from "../routing/index.js";
import { CORE, readPartsOff, setPartOff, type FactorySwitched, type FactorySwitcher, type StandInSwitchedBack } from "./settings.js";

/** Each part switched off, by part name, with the part it is off because of: itself, or one it stands on. */
export type PartsSwitched = ReadonlyMap<string, string>;

/**
 * Switch `part` of a host whose parts are `parts` on or off for this computer, or off with the factory plugin `plugin`
 * standing in for it (state `plugin`), recording who switched it (`by`) and when, and return the parts now named off. A
 * state but on, off or plugin, a plugin with no name, the core, and a part the host lacks are refused, saving nothing,
 * but a part the host lacks may be switched to a plugin, and back once the setting names it: a part that has left the
 * base, such as voice, is in no host's parts, and a factory plugin stands in for it.
 */
export function switchPart(part: string, state: string, parts: readonly string[], home: string = storytreeHome(), plugin?: string, by?: FactorySwitcher, now?: Date): readonly string[] {
  if (state !== "on" && state !== "off" && state !== "plugin") throw new VerbRefusal(`a part is switched on or off, or to a plugin, not ${JSON.stringify(state)}`, { misuse: true });
  if (state === "plugin" && (plugin === undefined || plugin === "")) throw new VerbRefusal("`settings set part <part> plugin <plugin>` names the plugin in your factory folder that stands in for the part", { misuse: true });
  if (!CORE.includes(part) && !parts.includes(part) && state !== "plugin" && !readPartsOff(home).includes(part)) {
    throw new VerbRefusal(`there is no part called ${part} here. Parts: ${parts.filter((one) => !CORE.includes(one)).sort().join(", ")}.`);
  }
  return setPartOff(part, state !== "on", home, state === "plugin" ? plugin : undefined, by, now);
}

/** Part name to the factory plugin standing in for it. */
export type StandInsNamed = Readonly<Record<string, string>>;

const THROUGH: Record<FactorySwitched["through"], string> = { "desktop app": "in the desktop app", "command line": "from the command line", "agent tool": "through an agent's tool" };

/** Who made one switch and when, after "switched" or "switched in" or "switched back". */
function switchSaid(record: FactorySwitched): string {
  return `${record.session === undefined ? "" : `by session ${record.session} `}${THROUGH[record.through]}, ${record.at}`;
}

/** Who switched a plugin in a part's place, and when: the record no approval stands in for (ADR-1126 D2). */
function recordSaid(record: FactorySwitched | undefined): string {
  return record === undefined ? "" : ` (switched ${switchSaid(record)})`;
}

/** The last plugin that stood in for a part now without one: who switched it in, and who switched it back. */
function pastSaid(past: readonly StandInSwitchedBack[] | undefined): string {
  const last = past?.at(-1);
  if (last === undefined) return "";
  return `, ${last.plugin} stood in for it (${last.in === undefined ? "" : `switched in ${switchSaid(last.in)}; `}switched back ${switchSaid(last.back)})`;
}

/** The parts switched off now, each that is off with another named with it or stood in for, and when a host takes the change. */
export function switchedSaid(switched: PartsSwitched, standIns: StandInsNamed = {}): string {
  const listed = [...switched].sort(([a], [b]) => a.localeCompare(b))
    .map(([part, because]) => because !== part ? `${part} (with ${because}, which it stands on)` : Object.hasOwn(standIns, part) ? `${part} (${standIns[part]} stands in for it)` : part);
  const said = listed.length === 0 ? "No part is switched off on this computer." : `Switched off on this computer: ${listed.join(", ")}.`;
  return `${said}\nThe command line takes it at its next command; restart the app and your sessions' MCP servers for them to take it.`;
}

/**
 * Each of the host's parts: on, off, off with a factory plugin standing in and who switched it, off with the part it
 * stands on, or always on (the core); a part with no stand-in now names the last one it had, who switched it in and back.
 */
export function partsSaid(parts: readonly string[], switched: PartsSwitched, standIns: StandInsNamed = {}, records: Readonly<Record<string, FactorySwitched>> = {}, history: Readonly<Record<string, readonly StandInSwitchedBack[]>> = {}): string {
  const lines = [...parts].sort().map((part) => {
    const because = switched.get(part);
    const standIn = Object.hasOwn(standIns, part) ? `, ${standIns[part]} stands in for it${recordSaid(records[part])}` : pastSaid(history[part]);
    const state = CORE.includes(part) ? "always on (the core)" : because === undefined ? `on${pastSaid(history[part])}` : because === part ? `off${standIn}` : `off, with ${because}${pastSaid(history[part])}`;
    return `  ${part}: ${state}`;
  });
  return `Parts of storytree (switch one with \`storytree settings set part <part> on|off|plugin <plugin>\`):\n${lines.join("\n")}`;
}

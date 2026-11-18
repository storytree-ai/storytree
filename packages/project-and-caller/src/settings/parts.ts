// Capability 2 · Settings
import { VerbRefusal } from "@storytree/library/verbs";

import { storytreeHome } from "../routing/index.js";
import { CORE, readPartsOff, setPartOff, type FactorySwitched, type FactorySwitcher, type StandInSwitchedBack } from "./settings.js";

export type PartsSwitched = ReadonlyMap<string, string>;

export function switchPart(part: string, state: string, parts: readonly string[], home: string = storytreeHome(), plugin?: string, by?: FactorySwitcher, now?: Date): readonly string[] {
  if (state !== "on" && state !== "off" && state !== "plugin") throw new VerbRefusal(`a module is switched on or off, or to a plugin, not ${JSON.stringify(state)}`, { misuse: true });
  if (state === "plugin" && (plugin === undefined || plugin === "")) throw new VerbRefusal("`settings set module <module> plugin <plugin>` names the plugin in your factory folder that stands in for the module", { misuse: true });
  if (!CORE.includes(part) && !parts.includes(part) && (state !== "plugin" || plugin !== part) && !readPartsOff(home).includes(part)) {
    const add = state === "plugin" ? ` To add ${plugin}, standing in for no module, switch it on under its own name: storytree settings set module ${plugin} plugin ${plugin}` : "";
    throw new VerbRefusal(`there is no module called ${part} here. Modules: ${parts.filter((one) => !CORE.includes(one)).sort().join(", ")}.${add}`);
  }
  return setPartOff(part, state !== "on", home, state === "plugin" ? plugin : undefined, by, now);
}

export type StandInsNamed = Readonly<Record<string, string>>;

const THROUGH: Record<FactorySwitched["through"], string> = { "desktop app": "in the desktop app", "command line": "from the command line", "agent tool": "through an agent's tool" };

function switchSaid(record: FactorySwitched): string {
  return `${record.session === undefined ? "" : `by session ${record.session} `}${THROUGH[record.through]}, ${record.at}`;
}

function recordSaid(record: FactorySwitched | undefined): string {
  return record === undefined ? "" : ` (switched ${switchSaid(record)})`;
}

function pastSaid(past: readonly StandInSwitchedBack[] | undefined): string {
  const last = past?.at(-1);
  if (last === undefined) return "";
  return `, ${last.plugin} stood in for it (${last.in === undefined ? "" : `switched in ${switchSaid(last.in)}; `}switched back ${switchSaid(last.back)})`;
}

function added(part: string, standIns: StandInsNamed, host: readonly string[] | undefined): boolean {
  return host !== undefined && !host.includes(part) && Object.hasOwn(standIns, part);
}

export function switchedSaid(switched: PartsSwitched, standIns: StandInsNamed = {}, host?: readonly string[]): string {
  const sorted = [...switched].sort(([a], [b]) => a.localeCompare(b));
  const adds = sorted.filter(([part]) => added(part, standIns, host)).map(([part]) => `${part} (by the factory plugin ${standIns[part]})`);
  const listed = sorted.filter(([part]) => !added(part, standIns, host))
    .map(([part, because]) => because !== part ? `${part} (with ${because}, which it stands on)` : Object.hasOwn(standIns, part) ? `${part} (${standIns[part]} stands in for it)` : part);
  const said = listed.length === 0 ? "No module is switched off on this computer." : `Switched off on this computer: ${listed.join(", ")}.`;
  return `${adds.length === 0 ? "" : `Added on this computer: ${adds.join(", ")}.\n`}${said}\nThe command line takes it at its next command; restart the app and your sessions' MCP servers for them to take it.`;
}

export function partsSaid(parts: readonly string[], switched: PartsSwitched, standIns: StandInsNamed = {}, records: Readonly<Record<string, FactorySwitched>> = {}, history: Readonly<Record<string, readonly StandInSwitchedBack[]>> = {}, host?: readonly string[]): string {
  const lines = [...parts].sort().map((part) => {
    if (added(part, standIns, host)) return `  ${part}: added by the factory plugin ${standIns[part]}${recordSaid(records[part])}`;
    const because = switched.get(part);
    const standIn = Object.hasOwn(standIns, part) ? `, ${standIns[part]} stands in for it${recordSaid(records[part])}` : pastSaid(history[part]);
    const state = CORE.includes(part) ? "always on (the core)" : because === undefined ? `on${pastSaid(history[part])}` : because === part ? `off${standIn}` : `off, with ${because}${pastSaid(history[part])}`;
    return `  ${part}: ${state}`;
  });
  return `Modules of storytree (switch one with \`storytree settings set module <module> on|off|plugin <plugin>\`):\n${lines.join("\n")}`;
}

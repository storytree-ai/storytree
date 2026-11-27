// Capability 17 · The library's commands
import type { LibraryVerbContext } from "../context.js";

export async function dormantSaid(context: LibraryVerbContext, kinds?: readonly string[]): Promise<string[]> {
  const said: string[] = [];
  for (const { kind, count } of await context.library.dormantKinds()) {
    if (kinds !== undefined && !kinds.includes(kind)) continue;
    const plugin = kind.slice(0, kind.indexOf("."));
    const mountable = context.pluginInFactory === undefined || (await context.pluginInFactory(plugin));
    const how = mountable ? `mount it with storytree settings set module ${plugin} plugin ${plugin}.` : `${plugin} is not in this computer's factory, so it cannot be mounted here.`;
    const many = count === 1 ? `1 ${kind} record is dormant here: its` : `${count} ${kind} records are dormant here: their`;
    said.push(`${many} plugin, ${plugin}, is not mounted on this computer; ${how}`);
  }
  return said;
}

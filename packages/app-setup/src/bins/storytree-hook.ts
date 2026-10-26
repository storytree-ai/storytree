/**
 * Capability 8 · Setup check. The hook command setup registers (`storytree-hook <harness>`): Session management's hook
 * command, given the map's file-to-capability lookup for its gate before each edit (ADR-0949 D3), which the agent
 * link may not import (ADR-0969). This is where the two meet: the app setup story may import both.
 *
 * Only the lookup's declared half is given: a file's opening "Capability N · …", or a test file's one numbered
 * capability. The code survey's inference is too slow for a hook the harness waits on, and too often wrong to stop
 * work on. The map is loaded only when an edit is gated, so every other hook stays quick.
 */
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import type { AnnotatedTree } from "@storytree/library";
import { deafIfHandingOffAtOnce } from "@storytree/session-management/hook-start";

/**
 * The capability each file declares, by the map's rule, its survey's inference never read. Typed here, not
 * with Session management's name for the lookup, so this story imports no shape of it (ADR-1017 D2).
 */
export const declaredCapabilities = async (checkout: string, files: readonly string[], tree: AnnotatedTree, readText: (file: string) => string): Promise<ReadonlyMap<string, string>> => {
  const { capabilitiesOfFiles } = await import("@storytree/map/code-survey");
  const placed = await capabilitiesOfFiles(checkout, files, tree, { readText, survey: async () => ({}) });
  return new Map([...placed].flatMap(([file, { capability, inferred }]) => (inferred ? [] : [[file, capability] as const])));
};

// Run only as the built command, never when a test imports the lookup. Node loads the command by its real path. A hook
// Claude Code stops by SIGTERM is deaf to it before the rest of the command loads (a separate chunk, imported after).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  deafIfHandingOffAtOnce();
  const [{ default: hooks }, { mount }, { readPartsOff }] = await Promise.all([import("#parts/hooks"), import("@storytree/plugin-loader/switch"), import("@storytree/project-and-caller")]);
  for (const hookCommand of mount(hooks, partsOff(readPartsOff)).mounted) hookCommand({ declaredCapabilities });
}

/** The parts this computer switches off; a damaged setting switches none off here, since a hook never stops the agent beside it. */
function partsOff(read: () => readonly string[]): readonly string[] {
  try {
    return read();
  } catch {
    return [];
  }
}

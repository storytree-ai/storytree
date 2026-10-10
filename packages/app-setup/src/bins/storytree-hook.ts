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

import { hookCommand, type DeclaredCapabilities } from "@storytree/session-management/hook-command";

/** The capability each file declares, by the map's rule, its survey's inference never read. */
export const declaredCapabilities: DeclaredCapabilities = async (checkout, files, tree, readText) => {
  const { capabilitiesOfFiles } = await import("@storytree/map/code-survey");
  const placed = await capabilitiesOfFiles(checkout, files, tree, { readText, survey: async () => ({}) });
  return new Map([...placed].flatMap(([file, { capability, inferred }]) => (inferred ? [] : [[file, capability] as const])));
};

// Run only as the built command, never when a test imports the lookup. Node loads the command by its real path.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) hookCommand({ declaredCapabilities });

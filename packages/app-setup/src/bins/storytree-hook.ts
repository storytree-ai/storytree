// Capability 18 · Built commands.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import type { AnnotatedTree } from "@storytree/library";
import { deafIfHandingOffAtOnce, refuseUnloaded } from "@storytree/session-management/hook-start";

export const declaredCapabilities = async (checkout: string, files: readonly string[], tree: AnnotatedTree, readText: (file: string) => string): Promise<ReadonlyMap<string, string>> => {
  const { capabilitiesOfFiles } = await import("@storytree/map/code-survey");
  const placed = await capabilitiesOfFiles(checkout, files, tree, { readText, survey: async () => ({}) });
  return new Map([...placed].flatMap(([file, { capability, inferred }]) => (inferred ? [] : [[file, capability] as const])));
};

export const readsCode = async (file: string): Promise<boolean> => {
  const { languagesOf } = await import("@storytree/map/languages");
  return languagesOf([file]).read.length > 0;
};

export const isCode = async (file: string): Promise<boolean> => {
  const { languagesOf } = await import("@storytree/map/languages");
  const { read, unread } = languagesOf([file]);
  return read.length > 0 || unread.length > 0;
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  deafIfHandingOffAtOnce();
  const [{ default: hooks }, { mount }, { readPartsOff }] = await Promise.all([import("#parts/hooks"), import("@storytree/plugin-loader/switch"), import("@storytree/project-and-caller")]).catch(refuseUnloaded);
  for (const hookCommand of mount(hooks, partsOff(readPartsOff)).mounted) hookCommand({ declaredCapabilities, readsCode, isCode });
}

function partsOff(read: () => readonly string[]): readonly string[] {
  try {
    return read();
  } catch {
    return [];
  }
}

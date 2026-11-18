// Capability 8 · Code survey
import { readdir } from "node:fs/promises";
import path from "node:path";

import { languagesOf } from "./languages.js";
import { gitText, SKIPPED } from "./survey-source.js";

const WALK_LIMIT = 20_000;

export async function folderLanguages(folder: string, { walkLimit = WALK_LIMIT }: { walkLimit?: number } = {}): Promise<{ readonly read: string[]; readonly unread: string[] }> {
  const tracked = await gitText(folder, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).then((text) => text.split("\0").filter(Boolean), () => undefined);
  return languagesOf(tracked ?? (await walked(folder, walkLimit)));
}

async function walked(folder: string, limit: number): Promise<string[]> {
  const files: string[] = [];
  const folders = [folder];
  while (folders.length > 0 && files.length < limit) {
    const at = folders.shift()!;
    for (const entry of await readdir(at, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED.has(entry.name)) folders.push(path.join(at, entry.name));
      else if (entry.isFile()) files.push(entry.name);
    }
  }
  return files;
}

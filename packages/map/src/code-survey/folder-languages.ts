/**
 * Capability 8 · Code survey: the languages a folder's code is in, read from disk (8.53). A checkout's are its
 * tracked files, as Git lists them; a folder outside one is walked, past what the survey skips and hidden folders,
 * up to a bound, so a huge folder answers from what it read first.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

import { languagesOf } from "./languages.js";
import { gitText, SKIPPED } from "./survey-source.js";

/** The most files a walk outside a checkout reads the names of. */
const WALK_LIMIT = 20_000;

/** The languages `folder`'s code is in: those the survey reads, and those it cannot. */
export async function folderLanguages(folder: string): Promise<{ readonly read: string[]; readonly unread: string[] }> {
  const tracked = await gitText(folder, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).then((text) => text.split("\0").filter(Boolean), () => undefined);
  return languagesOf(tracked ?? (await walked(folder)));
}

async function walked(folder: string): Promise<string[]> {
  const files: string[] = [];
  const folders = [folder];
  while (folders.length > 0 && files.length < WALK_LIMIT) {
    const at = folders.shift()!;
    for (const entry of await readdir(at, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED.has(entry.name)) folders.push(path.join(at, entry.name));
      else if (entry.isFile()) files.push(entry.name);
    }
  }
  return files;
}

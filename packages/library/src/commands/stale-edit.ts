// Capability 17 · The library's commands
import type { Library, WriteOptions } from "../index.js";
import { VerbRefusal } from "../verbs/verb.js";

export const RECENT_MS = 15 * 60 * 1000;

export async function refuseStaleEdit(library: Pick<Library, "history">, id: string, writer: WriteOptions, read: string | undefined, now = Date.now()): Promise<void> {
  const seen = read === undefined ? undefined : Number(read);
  if (seen !== undefined && !(Number.isSafeInteger(seen) && seen > 0)) throw new VerbRefusal(`--read is a history entry's seq, a whole number above 0, not ${JSON.stringify(read)}`, { misuse: true });
  const newest = (await library.history({ id })).at(-1);
  if (newest === undefined) return;
  const stale = seen === undefined
    ? newest.actor !== undefined && newest.actor !== writer.actor && now - Date.parse(newest.at) < RECENT_MS
    : newest.seq !== seen;
  if (!stale) return;
  const since = seen === undefined ? `another writer changed it ${Math.max(0, Math.round((now - Date.parse(newest.at)) / 1000))} s ago` : `it changed since history entry ${seen}`;
  throw new VerbRefusal(
    `${id} was not edited: ${since}, at entry ${newest.seq} (${newest.at}, by ${newest.actor ?? "a writer who gave no name"}), so this edit could replace that change unread. ` +
      `Read it again (library read ${id}), re-apply your change to what it holds now, and edit again naming entry ${newest.seq} as read (--read ${newest.seq}).`,
  );
}

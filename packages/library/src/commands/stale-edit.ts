/**
 * Capability 17 · The library's commands: a whole-field edit built on a stale read (friction_90ff039d8cce): the writer would put back a field as it read it,
 * and a change another writer made since would vanish with no conflict raised.
 */
import type { Library, WriteOptions } from "../index.js";
import { VerbRefusal } from "../verbs/verb.js";

/** How long another writer's change stands as one the writer may not have read, when the writer names no read. */
export const RECENT_MS = 15 * 60 * 1000;

/**
 * Refuse, with nothing written, an edit of `id` by `writer` built on a stale read: given `read`, the seq of the newest
 * history entry the writer read, any other newest entry; given none, a newest entry another writer made within
 * RECENT_MS of `now`. The refusal names the newer change, so the writer reads the record again and re-applies the edit.
 */
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

// Capability 17 · The library's commands
import type { Library } from "../../index.js";
import type { WriteOptions } from "../../storage/rules/index.js";
import { VerbRefusal } from "./verb.js";

export const RECENT_MS = 15 * 60 * 1000;

export async function refuseStaleEdit(library: Pick<Library, "history">, id: string, writer: WriteOptions | undefined, read: string | undefined, now: number = Date.now()): Promise<void> {
  if (read !== undefined && !/^\d+$/.test(read.trim())) throw new VerbRefusal(`--read is the seq of the history entry you read (library history ${id}), not ${JSON.stringify(read)}`, { misuse: true });
  const newest = (await library.history({ id })).at(-1);
  if (newest === undefined) return;
  const by = newest.actor ?? "a writer who gave no name";
  if (read !== undefined) {
    if (newest.seq === Number(read)) return;
    throw new VerbRefusal(`${id} changed after entry ${read}, the one you read: its newest is entry ${newest.seq}, by ${by} at ${newest.at}. Read it again (library history ${id}), apply your change to what it holds now and give --read ${newest.seq}; nothing was written.`);
  }
  if (newest.actor === undefined || newest.actor === writer?.actor || now - Date.parse(newest.at) >= RECENT_MS) return;
  throw new VerbRefusal(`${id} was changed in the last 15 minutes by another writer: entry ${newest.seq}, by ${by} at ${newest.at}. Read it (library history ${id}), apply your change to what it holds now and give --read ${newest.seq}; nothing was written.`);
}

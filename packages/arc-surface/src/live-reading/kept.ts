/**
 * A surface's last known state, kept in the page's own storage so the next start can draw it at
 * once, marked as not yet fresh, while the live reading crosses the network. Each story names its
 * own key and judges its own shape; the app only gives the page its storage, which survives restarts
 * and updates because the app keeps one data folder. Storage is optional: a denied, full, unreadable
 * or foreign value gives nothing and never stops a reading.
 */
import type { Line } from "@storytree/agent-link";
import type { Change } from "@storytree/library";

import type { KeptReading } from "./page-reading.js";

/** What is kept for one surface. */
export interface Kept<T> {
  read(): T | undefined;
  write(value: T): void;
}

/** The page storage it needs: `localStorage`'s two calls. */
export type PageStorage = Pick<Storage, "getItem" | "setItem">;

function pageStorage(): PageStorage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** The value kept under `key`, read back only when `accept` recognises its shape; null storage keeps nothing. */
export function pageKept<T>(key: string, accept: (value: unknown) => value is T, storage: PageStorage | null = pageStorage()): Kept<T> {
  return {
    read() {
      try {
        const value: unknown = JSON.parse(storage?.getItem(key) ?? "null");
        return accept(value) ? value : undefined;
      } catch { return undefined; }
    },
    write(value) {
      try { storage?.setItem(key, JSON.stringify(value)); } catch { /* This start still shows it. */ }
    },
  };
}

/** The page's database of kept readings, its pieces in one store, each marked with its reading's key. */
const KEPT_DATABASE = "storytree.kept-readings";
const PIECES = "pieces";
/** Past this many pieces, the next start keeps them as one. */
const PIECES_BEFORE_JOINING = 500;

/** One piece of a kept reading, as the page's database holds it. */
interface Piece { reading: string; changes: Change[]; lines: Line[] }

function request<T>(asked: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    asked.onsuccess = () => resolve(asked.result);
    asked.onerror = () => reject(asked.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

let opening: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const asked = globalThis.indexedDB.open(KEPT_DATABASE, 1);
    asked.onupgradeneeded = () => asked.result.createObjectStore(PIECES, { autoIncrement: true }).createIndex("reading", "reading");
    asked.onsuccess = () => resolve(asked.result);
    asked.onerror = () => reject(asked.error);
  });
  opening.catch(() => { opening = undefined; });
  return opening;
}

/**
 * A live reading kept under `key` in the page's database (IndexedDB, which holds more than the page's
 * small storage), a piece per news, so keeping costs only what is new. A page with no database
 * keeps nothing, and a failure to keep never stops a reading.
 */
export function pageKeptReading(key: string): KeptReading {
  const pieces = async (mode: IDBTransactionMode) => (await database()).transaction(PIECES, mode);
  const clear = async (transaction: IDBTransaction): Promise<void> => {
    const keys = await request(transaction.objectStore(PIECES).index("reading").getAllKeys(key));
    for (const one of keys) transaction.objectStore(PIECES).delete(one);
  };
  return {
    async read() {
      if (globalThis.indexedDB === undefined) return undefined;
      const transaction = await pieces("readonly");
      const all = await request(transaction.objectStore(PIECES).index("reading").getAll(key)) as Piece[];
      if (all.length === 0) return undefined;
      const whole = { changes: all.flatMap(({ changes }) => changes), lines: all.flatMap(({ lines }) => lines) };
      if (all.length > PIECES_BEFORE_JOINING) {
        // Many small pieces are read back slower than one: keep them as one.
        const joining = await pieces("readwrite");
        await clear(joining);
        joining.objectStore(PIECES).add({ reading: key, ...whole } satisfies Piece);
        await done(joining).catch(() => {});
      }
      return whole;
    },
    async add(news) {
      if (globalThis.indexedDB === undefined) return;
      const transaction = await pieces("readwrite");
      transaction.objectStore(PIECES).add({ reading: key, changes: news.changes, lines: news.lines } satisfies Piece);
      await done(transaction);
    },
    async clear() {
      if (globalThis.indexedDB === undefined) return;
      const transaction = await pieces("readwrite");
      await clear(transaction);
      await done(transaction);
    },
  };
}

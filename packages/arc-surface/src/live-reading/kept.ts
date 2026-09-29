/**
 * A surface's last known state, kept in the page's own storage so the next start can draw it at
 * once, marked as not yet fresh, while the live reading crosses the network. Each story names its
 * own key and judges its own shape; the app only gives the page its storage, which survives restarts
 * and updates because the app keeps one data folder. Storage is optional: a denied, full, unreadable
 * or foreign value gives nothing and never stops a reading.
 */

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

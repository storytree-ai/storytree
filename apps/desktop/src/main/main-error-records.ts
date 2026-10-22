/**
 * Capability 1 · Lifecycle. The main process's uncaught exceptions and unhandled rejections, kept in the user's own
 * library on every install (contract 1.25, the owner's answer to question_010c37c7a21c), beside app.log, which installed
 * releases do not write. An app error belongs to no project, so it is kept in a database of the app's own on the
 * library's server, one row for each error: the same error again (its kind, build and stack) adds to its count, so a
 * loop cannot flood the library. Nothing here leaves the user's machine.
 *
 * Errors before the library opens are held, a bounded few, and written once it does. A write that fails is said in the
 * log and dropped: app.log keeps the error either way, and the failure raises nothing (contract 1.26).
 */
import { createHash } from "node:crypto";

import type { Storytree } from "@storytree/library";

/** The app's own database the errors are kept in, beside the projects' libraries on the same server. */
export const MAIN_ERRORS_DATABASE = "storytree-app-errors";

const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS main_errors (
    key      text PRIMARY KEY,
    kind     text NOT NULL CHECK (kind IN ('uncaught-exception', 'unhandled-rejection')),
    build    text NOT NULL,
    stack    text NOT NULL,
    count    integer NOT NULL,
    first_at timestamptz NOT NULL,
    last_at  timestamptz NOT NULL
  )`,
];

export type MainErrorKind = "uncaught-exception" | "unhandled-rejection";

interface Held {
  readonly key: string;
  readonly kind: MainErrorKind;
  readonly build: string;
  readonly stack: string;
  count: number;
  readonly firstAt: Date;
  lastAt: Date;
}

type Pool = Awaited<ReturnType<Storytree["ownDatabase"]>>;

export interface MainErrorRecords {
  /** Keep one error: written now if the library is open, else held until it is. */
  record(kind: MainErrorKind, stack: string): void;
  /** The library is open: write what is held, and from now on each error as it comes. */
  open(server: Pick<Storytree, "ownDatabase">): Promise<void>;
  /** Resolves once every write asked for so far has finished. */
  settled(): Promise<void>;
}

/**
 * Keep the main process's errors in the library `open` is given. `build` names the running build at each error; `log`
 * is app.log's; at most `hold` different errors wait for the library (later ones are left to app.log).
 */
export function mainErrorRecords({ build, log, now = () => new Date(), hold = 50, database = MAIN_ERRORS_DATABASE }: {
  build: () => string;
  log: (line: string) => void;
  now?: () => Date;
  hold?: number;
  database?: string;
}): MainErrorRecords {
  const held = new Map<string, Held>();
  let pool: Pool | undefined;
  let writing: Promise<void> | undefined;

  // One write at a time: what arrives meanwhile is held, and a repeat only adds to its held count.
  const write = (): void => {
    if (pool === undefined || writing !== undefined || held.size === 0) return;
    const into = pool;
    const rows = [...held.values()];
    held.clear();
    writing = writeRows(into, rows)
      .catch((error: unknown) => log(`main process errors not recorded in the library (${rows.length}): ${described(error)}`))
      .finally(() => { writing = undefined; write(); });
  };

  return {
    record(kind, stack) {
      const at = now();
      const running = build();
      const key = createHash("sha256").update(`${kind}\0${running}\0${stack}`).digest("hex");
      const same = held.get(key);
      if (same !== undefined) {
        same.count += 1;
        same.lastAt = at;
      } else if (held.size < hold) {
        held.set(key, { key, kind, build: running, stack, count: 1, firstAt: at, lastAt: at });
      }
      write();
    },
    async open(server) {
      try {
        pool = await server.ownDatabase(database, { tables: SCHEMA });
      } catch (error) {
        log(`main process errors will not be recorded in the library: ${described(error)}`);
        return;
      }
      write();
    },
    async settled() {
      while (writing !== undefined) await writing;
    },
  };
}

async function writeRows(pool: Pool, rows: readonly Held[]): Promise<void> {
  for (const row of rows) {
    await pool.query(
      `INSERT INTO main_errors (key, kind, build, stack, count, first_at, last_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (key) DO UPDATE SET count = main_errors.count + excluded.count, last_at = greatest(main_errors.last_at, excluded.last_at)`,
      [row.key, row.kind, row.build, row.stack, row.count, row.firstAt, row.lastAt],
    );
  }
}

function described(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

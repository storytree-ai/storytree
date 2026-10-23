/**
 * Capability 1 · Lifecycle. The main process's uncaught exceptions and unhandled rejections, kept in the user's own
 * library on every install (contract 1.25, the owner's answer to question_010c37c7a21c), beside the app's log, which an
 * installed release keeps nowhere. An app error belongs to no project, so it is kept in a database of the app's own on the
 * library's server, one row for each error: the same error again (its kind, build and stack) adds to its count, so a
 * loop cannot flood the library. Nothing here leaves the user's machine.
 *
 * Errors before the library opens are held, a bounded few, and written once it does. A write that fails is said in the
 * log and dropped: the log keeps the error either way, and the failure raises nothing (contract 1.26).
 *
 * Each record is written not yet submitted. While one is, opening the app asks the person to have their agent submit a
 * GitHub issue, until they mark it submitted from that box (contract 1.31, ADR-1122).
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
  // Installs from before ADR-1122 already have the table.
  "ALTER TABLE main_errors ADD COLUMN IF NOT EXISTS submitted_at timestamptz",
  // And from before contract 1.32, a kind check without its stopped restarts.
  "ALTER TABLE main_errors DROP CONSTRAINT IF EXISTS main_errors_kind_check",
  "ALTER TABLE main_errors ADD CONSTRAINT main_errors_kind_check CHECK (kind IN ('uncaught-exception', 'unhandled-rejection', 'restarts-stopped'))",
];

/** What went wrong: an uncaught error, or the app stopping restarting itself after too many in a row (contract 1.32). */
export type MainErrorKind = "uncaught-exception" | "unhandled-rejection" | "restarts-stopped";

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
  /** The recorded errors not yet marked submitted, oldest first; none while the library is not open. */
  unsubmitted(): Promise<readonly UnsubmittedError[]>;
  /** Mark these records submitted, so the app stops asking about them. */
  markSubmitted(keys: readonly string[]): Promise<void>;
}

export interface UnsubmittedError {
  readonly key: string;
  readonly stack: string;
}

/**
 * Keep the main process's errors in the library `open` is given. `build` names the running build at each error; `log`
 * is the log's; at most `hold` different errors wait for the library (later ones are left to the log).
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
    async unsubmitted() {
      if (pool === undefined) return [];
      const { rows } = await pool.query<UnsubmittedError>("SELECT key, stack FROM main_errors WHERE submitted_at IS NULL ORDER BY first_at");
      return rows;
    },
    async markSubmitted(keys) {
      if (pool === undefined || keys.length === 0) return;
      await pool.query("UPDATE main_errors SET submitted_at = $2 WHERE key = ANY($1) AND submitted_at IS NULL", [keys, now()]);
    },
  };
}

/** What the box about unsubmitted errors says, and its two ways out, in that order. */
export interface ReportMessage {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly ["Keep going", "It's been submitted"];
}

/** The message box `askToReportErrors` asks through: Keep going is the default, and closing the box keeps going too. */
export function reportBox(
  show: (options: ReportMessage & { type: "warning"; buttons: string[]; defaultId: 0; cancelId: 0; noLink: true }) => Promise<{ response: number }>,
): (message: ReportMessage) => Promise<"keep-going" | "submitted"> {
  return async ({ title, message, detail, buttons }) => {
    const { response } = await show({ type: "warning", title, message, detail, buttons: [...buttons], defaultId: 0, cancelId: 0, noLink: true });
    return response === 1 ? "submitted" : "keep-going";
  };
}

/**
 * When the library holds errors not yet submitted, ask once, in ADR-1119's words, for the person's agent to submit a
 * GitHub issue. "It's been submitted" marks every error the box listed; Keep going (the default) leaves them to ask again.
 */
export async function askToReportErrors(
  records: Pick<MainErrorRecords, "unsubmitted" | "markSubmitted">,
  { ask }: { ask: (message: ReportMessage) => Promise<"keep-going" | "submitted"> },
): Promise<void> {
  const errors = await records.unsubmitted();
  if (errors.length === 0) return;
  const lines = errors.map(error => `- ${error.stack.split("\n")[0]}`).join("\n");
  const choice = await ask({
    title: "storytree 0.3",
    message: errors.length === 1 ? "Something went wrong in storytree, and it has not been reported yet." : `${errors.length} things went wrong in storytree, and they have not been reported yet.`,
    detail: `Please ask your agent to submit a GitHub issue on github.com/storytree-ai/storytree, and we'll work on it. Once it has been submitted, say so here and this stops asking; until the next update, keep going with storytree as it is.\n\nWhat went wrong:\n${lines}`,
    buttons: ["Keep going", "It's been submitted"],
  });
  if (choice === "submitted") await records.markSubmitted(errors.map(error => error.key));
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

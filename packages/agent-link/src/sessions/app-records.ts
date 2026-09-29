/**
 * Capability 4 · Sessions: which sessions the Claude desktop app and Codex keep in their own records,
 * and whether they are archived there (ADR-0754 D4). A session one of them keeps stays in the
 * running-sessions list, shown done, until it is archived there.
 *
 * - The records are the apps' own private files on this machine, read only, never written: Claude's
 *   `claude-code-sessions/<account>/<org>/local_<id>.json` (its `cliSessionId`, the harness session
 *   id the lines carry, and `isArchived`), and Codex's `state_5.sqlite` table `threads` (`id`,
 *   `archived`), which the Codex app and its terminal share (`codex archive` archives there too).
 *   A Codex headless run (`source` exec) and a subagent (a JSON `source`) are not the app's.
 * - Membership in the app's record decides, never a harness's `entrypoint`, which a headless run
 *   started from inside the app inherits.
 * - Only sessions this project's log knows get a line, and only when their state changes: a
 *   `session-archived` or `session-unarchived` line, by whichever session read the files, never on
 *   the session it is about.
 * - It fails soft: absent files are absent (as on a machine without the app), damaged ones or a
 *   changed format unreadable, and either leaves sessions to the leave-after time. The setup check
 *   says which. Hooks run it at most once a minute per project and machine.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { Line } from "../activity/index.js";
import { due, type MergeContext } from "../claims/merges.js";
import type { SessionApp } from "../readings.js";

/** Where the apps keep their records on this machine. */
export interface AppPlaces {
  /** Claude desktop's `claude-code-sessions` folder. */
  readonly claudeSessions: string;
  /** Codex's `state_5.sqlite`. */
  readonly codexState: string;
}

/** What one app's record said: each session it keeps, by the harness's id for it, and whether it is archived. */
export interface AppReading {
  readonly app: SessionApp;
  readonly state: "read" | "absent" | "unreadable";
  readonly sessions: ReadonlyMap<string, boolean>;
  /** Why it could not be read, when it could not. */
  readonly problem?: string;
}

const EVERY_MS = 60_000;
/** How deep under `claude-code-sessions` the session files are: account, then organisation. */
const CLAUDE_DEPTH = 3;

/** Where the apps keep their records for this user, as each app places them on this system. */
export function defaultAppPlaces(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): AppPlaces {
  const home = homedir();
  const config = platform === "win32" ? (env.APPDATA ?? path.join(home, "AppData", "Roaming"))
    : platform === "darwin" ? path.join(home, "Library", "Application Support")
    : (env.XDG_CONFIG_HOME ?? path.join(home, ".config"));
  return { claudeSessions: path.join(config, "Claude", "claude-code-sessions"), codexState: path.join(env.CODEX_HOME ?? path.join(home, ".codex"), "state_5.sqlite") };
}

/** Read both apps' records. Never throws. */
export async function readAppRecords(places: AppPlaces = defaultAppPlaces()): Promise<AppReading[]> {
  return [readClaude(places.claudeSessions), await readCodex(places.codexState)];
}

/** Write a line for each session this project knows whose state in an app's record has changed. */
export async function recordAppStates(context: MergeContext, watch: { readonly places?: AppPlaces; readonly everyMs?: number } = {}): Promise<Line[]> {
  if (!due(`${context.project}-apps`, watch.everyMs ?? EVERY_MS)) return [];
  const kept = new Map<string, { app: SessionApp; archived: boolean }>();
  for (const reading of await readAppRecords(watch.places)) for (const [id, archived] of reading.sessions) kept.set(id, { app: reading.app, archived });
  if (kept.size === 0) return [];

  return context.log.locked(context.project, async (log) => {
    const known = await log.lastSeen();
    const current = new Map<string, Line & { kind: "session-archived" | "session-unarchived" }>();
    for (const line of await log.lines(["session-archived", "session-unarchived"])) if (line.kind === "session-archived" || line.kind === "session-unarchived") current.set(line.of, line);
    const written: Line[] = [];
    for (const [id, { app, archived }] of kept) {
      const kind = archived ? "session-archived" : "session-unarchived";
      const now = current.get(id);
      if (!known.has(id) || (now?.kind === kind && now.app === app)) continue;
      written.push(await log.append({
        session: context.session,
        ...(context.harness === undefined ? {} : { harness: context.harness }),
        source: context.source,
        folder: context.folder,
        kind,
        of: id,
        app,
      }));
    }
    return written;
  });
}

function readClaude(folder: string): AppReading {
  const app = "claude-desktop";
  if (!existsSync(folder)) return { app, state: "absent", sessions: new Map() };
  const sessions = new Map<string, boolean>();
  let files = 0;
  try {
    for (const file of sessionFiles(folder, CLAUDE_DEPTH)) {
      files += 1;
      try {
        const record = JSON.parse(readFileSync(file, "utf8")) as { cliSessionId?: unknown; isArchived?: unknown };
        if (typeof record.cliSessionId === "string" && record.cliSessionId !== "" && typeof record.isArchived === "boolean") sessions.set(record.cliSessionId, record.isArchived);
      } catch {
        // One damaged file is skipped; the rest still say what they say.
      }
    }
  } catch (error) {
    return { app, state: "unreadable", sessions: new Map(), problem: (error as Error).message };
  }
  return files > 0 && sessions.size === 0
    ? { app, state: "unreadable", sessions, problem: `none of its ${files} session files has a cliSessionId and an isArchived flag: its format may have changed` }
    : { app, state: "read", sessions };
}

/** The `local_*.json` files under `folder`, at most `depth` folders down. */
function sessionFiles(folder: string, depth: number): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory() && depth > 0) found.push(...sessionFiles(full, depth - 1));
    else if (entry.isFile() && /^local_.+\.json$/.test(entry.name)) found.push(full);
  }
  return found;
}

async function readCodex(file: string): Promise<AppReading> {
  const app = "codex";
  if (!existsSync(file)) return { app, state: "absent", sessions: new Map() };
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const rows = db.prepare("SELECT id, source, archived FROM threads").all() as { id: unknown; source: unknown; archived: unknown }[];
      const sessions = new Map<string, boolean>();
      for (const { id, source, archived } of rows) {
        // A headless run and a subagent are not the app's: the one is never archived, the other lives under its parent.
        if (typeof id !== "string" || typeof source !== "string" || source === "exec" || source.startsWith("{")) continue;
        sessions.set(id, Number(archived) !== 0);
      }
      return { app, state: "read", sessions };
    } finally {
      db.close();
    }
  } catch (error) {
    return { app, state: "unreadable", sessions: new Map(), problem: (error as Error).message };
  }
}

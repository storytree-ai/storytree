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
 * - How the app names and describes each such session (4.19), Claude's `title` and its post-turn
 *   summary's `status_detail`, Codex's thread `name` (else its `title`), gets a `session-described`
 *   line the same way: scrubbed, held to a few lines, written only when the words change.
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
import { scrub } from "../transcripts/scrub.js";

/** Where the apps keep their records on this machine. */
export interface AppPlaces {
  /** Claude desktop's `claude-code-sessions` folder. */
  readonly claudeSessions: string;
  /** Codex's `state_5.sqlite`. */
  readonly codexState: string;
}

/** How an app names and describes one session it keeps (4.19): the title it shows, and its latest status, when it has them. */
export interface AppDescription {
  readonly title?: string;
  readonly status?: string;
}

/** What one app's record said: each session it keeps, by the harness's id for it, and whether it is archived. */
export interface AppReading {
  readonly app: SessionApp;
  readonly state: "read" | "absent" | "unreadable";
  readonly sessions: ReadonlyMap<string, boolean>;
  /** How it names and describes each session it keeps, for those it gives any words. */
  readonly described: ReadonlyMap<string, AppDescription>;
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
  const kept = new Map<string, { app: SessionApp; archived: boolean; described?: AppDescription }>();
  for (const reading of await readAppRecords(watch.places)) {
    for (const [id, archived] of reading.sessions) {
      const described = reading.described.get(id);
      kept.set(id, { app: reading.app, archived, ...(described === undefined ? {} : { described }) });
    }
  }
  if (kept.size === 0) return [];

  return context.log.locked(context.project, async (log) => {
    // Only the sessions the apps keep are read, and the latest of what was said of each (contract 2.7).
    const known = await log.lastSeen([...kept.keys()]);
    const ids = [...known.keys()];
    const current = new Map<string, Line & { kind: "session-archived" | "session-unarchived" }>();
    const words = new Map<string, Line & { kind: "session-described" }>();
    const said = ids.length === 0 ? [] : [
      ...await log.lines({ kinds: ["session-archived", "session-unarchived"], where: { of: ids }, latestBy: ["of"] }),
      ...await log.lines({ kinds: ["session-described"], where: { of: ids }, latestBy: ["of"] }),
    ];
    for (const line of said) {
      if (line.kind === "session-archived" || line.kind === "session-unarchived") current.set(line.of, line);
      else if (line.kind === "session-described") words.set(line.of, line);
    }
    const by = { session: context.session, ...(context.harness === undefined ? {} : { harness: context.harness }), source: context.source, folder: context.folder };
    const written: Line[] = [];
    for (const [id, { app, archived, described }] of kept) {
      if (!known.has(id)) continue;
      const kind = archived ? "session-archived" : "session-unarchived";
      const now = current.get(id);
      if (!(now?.kind === kind && now.app === app)) written.push(await log.append({ ...by, kind, of: id, app }));
      const said = words.get(id);
      if (described !== undefined && (said?.app !== app || said.title !== described.title || said.status !== described.status)) {
        written.push(await log.append({ ...by, kind: "session-described", of: id, app, ...described }));
      }
    }
    return written;
  });
}

/** The longest title and status a line carries: a name and a few lines, never a transcript. */
const TITLE_LIMIT = 120;
const STATUS_LIMIT = 300;

/** An app's words for a session, trimmed, scrubbed and held to their limits; undefined when it gives none. */
function descriptionOf(title: unknown, status: unknown): AppDescription | undefined {
  const words = (text: unknown, limit: number): string | undefined => {
    if (typeof text !== "string" || text.trim() === "") return undefined;
    const clean = scrub(text.trim().replace(/\s+/g, " "));
    return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
  };
  const said = { title: words(title, TITLE_LIMIT), status: words(status, STATUS_LIMIT) };
  if (said.title === undefined && said.status === undefined) return undefined;
  return { ...(said.title === undefined ? {} : { title: said.title }), ...(said.status === undefined ? {} : { status: said.status }) };
}

function readClaude(folder: string): AppReading {
  const app = "claude-desktop";
  if (!existsSync(folder)) return { app, state: "absent", sessions: new Map(), described: new Map() };
  const sessions = new Map<string, boolean>();
  const described = new Map<string, AppDescription>();
  let files = 0;
  try {
    for (const file of sessionFiles(folder, CLAUDE_DEPTH)) {
      files += 1;
      try {
        const record = JSON.parse(readFileSync(file, "utf8")) as { cliSessionId?: unknown; isArchived?: unknown; title?: unknown; postTurnSummary?: { status_detail?: unknown } | null };
        if (typeof record.cliSessionId === "string" && record.cliSessionId !== "" && typeof record.isArchived === "boolean") {
          sessions.set(record.cliSessionId, record.isArchived);
          const words = descriptionOf(record.title, record.postTurnSummary?.status_detail);
          if (words !== undefined) described.set(record.cliSessionId, words);
        }
      } catch {
        // One damaged file is skipped; the rest still say what they say.
      }
    }
  } catch (error) {
    return { app, state: "unreadable", sessions: new Map(), described: new Map(), problem: (error as Error).message };
  }
  return files > 0 && sessions.size === 0
    ? { app, state: "unreadable", sessions, described, problem: `none of its ${files} session files has a cliSessionId and an isArchived flag: its format may have changed` }
    : { app, state: "read", sessions, described };
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
  if (!existsSync(file)) return { app, state: "absent", sessions: new Map(), described: new Map() };
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      // A thread's name is the one people gave it; its title, the app's own. Older stores have neither column.
      const columns = new Set((db.prepare("PRAGMA table_info(threads)").all() as { name: string }[]).map((column) => column.name));
      const words = ["name", "title"].filter((column) => columns.has(column));
      const rows = db.prepare(`SELECT ${["id", "source", "archived", ...words].join(", ")} FROM threads`).all() as { id: unknown; source: unknown; archived: unknown; name?: unknown; title?: unknown }[];
      const sessions = new Map<string, boolean>();
      const described = new Map<string, AppDescription>();
      for (const { id, source, archived, name, title } of rows) {
        // A headless run and a subagent are not the app's: the one is never archived, the other lives under its parent.
        if (typeof id !== "string" || typeof source !== "string" || source === "exec" || source.startsWith("{")) continue;
        sessions.set(id, Number(archived) !== 0);
        const said = descriptionOf(typeof name === "string" && name.trim() !== "" ? name : title, undefined);
        if (said !== undefined) described.set(id, said);
      }
      return { app, state: "read", sessions, described };
    } finally {
      db.close();
    }
  } catch (error) {
    return { app, state: "unreadable", sessions: new Map(), described: new Map(), problem: (error as Error).message };
  }
}

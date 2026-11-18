// Capability 4 · Sessions
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { Line } from "@storytree/library";
import { due, type MergeContext } from "../claims/merges.js";
import type { SessionApp } from "../readings.js";
import { scrub } from "../transcripts/scrub.js";

export interface AppPlaces {
  readonly claudeSessions: string;
  readonly codexState: string;
}

export interface AppDescription {
  readonly title?: string;
  readonly status?: string;
}

export interface AppReading {
  readonly app: SessionApp;
  readonly state: "read" | "absent" | "unreadable";
  readonly sessions: ReadonlyMap<string, boolean>;
  readonly described: ReadonlyMap<string, AppDescription>;
  readonly problem?: string;
}

const EVERY_MS = 60_000;
const CLAUDE_DEPTH = 3;

export function defaultAppPlaces(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): AppPlaces {
  const home = homedir();
  const config = platform === "win32" ? (env.APPDATA ?? path.join(home, "AppData", "Roaming"))
    : platform === "darwin" ? path.join(home, "Library", "Application Support")
    : (env.XDG_CONFIG_HOME ?? path.join(home, ".config"));
  return { claudeSessions: path.join(config, "Claude", "claude-code-sessions"), codexState: path.join(env.CODEX_HOME ?? path.join(home, ".codex"), "state_5.sqlite") };
}

export async function readAppRecords(places: AppPlaces = defaultAppPlaces()): Promise<AppReading[]> {
  return [readClaude(places.claudeSessions), await readCodex(places.codexState)];
}

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

const TITLE_LIMIT = 120;
const STATUS_LIMIT = 300;

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
      }
    }
  } catch (error) {
    return { app, state: "unreadable", sessions: new Map(), described: new Map(), problem: (error as Error).message };
  }
  return files > 0 && sessions.size === 0
    ? { app, state: "unreadable", sessions, described, problem: `none of its ${files} session files has a cliSessionId and an isArchived flag: its format may have changed` }
    : { app, state: "read", sessions, described };
}

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
      const columns = new Set((db.prepare("PRAGMA table_info(threads)").all() as { name: string }[]).map((column) => column.name));
      const words = ["name", "title"].filter((column) => columns.has(column));
      const rows = db.prepare(`SELECT ${["id", "source", "archived", ...words].join(", ")} FROM threads`).all() as { id: unknown; source: unknown; archived: unknown; name?: unknown; title?: unknown }[];
      const sessions = new Map<string, boolean>();
      const described = new Map<string, AppDescription>();
      for (const { id, source, archived, name, title } of rows) {
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

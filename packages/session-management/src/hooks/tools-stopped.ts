// Capability 3 · Hooks
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { route } from "@storytree/project-and-caller";
import { notYetGivenIds } from "./given-once.js";

export const TOOLS_STOPPED = "tools-stopped";

const SESSION = /^[A-Za-z0-9._-]+$/;
const starts = () => path.join(tmpdir(), "storytree-session-starts");

export function noteSessionStart(harness: string, input: unknown, now: number = Date.now()): void {
  const about = sessionOf(harness, input);
  if (about === undefined || about.event !== "SessionStart" || (about.source !== undefined && about.source !== "startup" && about.source !== "resume")) return;
  try {
    mkdirSync(starts(), { recursive: true });
    writeFileSync(path.join(starts(), `${about.session}.json`), JSON.stringify(now));
  } catch {
  }
}

export interface ToolsStoppedNotice {
  readonly agent: string;
  readonly user: string;
}

export function toolsStoppedNotice(harness: string, input: unknown, home: string): ToolsStoppedNotice | undefined {
  try {
    const about = sessionOf(harness, input);
    if (about === undefined || about.folder === undefined) return undefined;
    const stopped = statSync(path.join(home, TOOLS_STOPPED), { throwIfNoEntry: false })?.mtimeMs;
    if (stopped === undefined) return undefined;
    const started = startOf(about.session, about.transcript);
    if (started === undefined || started >= stopped) return undefined;
    if (route(about.folder).status === "not-a-project") return undefined;
    if (notYetGivenIds(about.session, ["tools-stopped"], "tools-stopped").length === 0) return undefined;
    const what = harness === "codex"
      ? "Codex does not start a stopped tool server again: ask the user to restart this session (quit Codex and resume it, `codex resume`)"
      : "ask the user to reconnect it: in Claude Code, run /mcp, choose storytree and Reconnect (or restart the session)";
    const at = new Date(stopped).toISOString().replace(/\.\d+Z$/, "Z");
    return {
      agent: `[storytree] storytree's tools in this session were stopped by a storytree update (at ${at}), so a call to one fails with "Connection closed" or "Transport closed" until its tool server starts again. Nothing is broken; ${what}. The pnpm storytree / storytree command line still works meanwhile.`,
      user: harness === "codex" ? "storytree was updated and stopped this session's storytree tools: restart the session to use them again." : "storytree was updated and stopped this session's storytree tools: run /mcp, choose storytree and Reconnect to use them again.",
    };
  } catch {
    return undefined;
  }
}

function startOf(session: string, transcript: string | undefined): number | undefined {
  try {
    const noted: unknown = JSON.parse(readFileSync(path.join(starts(), `${session}.json`), "utf8"));
    if (typeof noted === "number") return noted;
  } catch {
  }
  if (transcript === undefined) return undefined;
  const born = statSync(transcript, { throwIfNoEntry: false })?.birthtimeMs;
  return born === undefined || born <= 0 ? undefined : born;
}

function sessionOf(harness: string, input: unknown): { event: unknown; session: string; folder?: string; transcript?: string; source?: unknown } | undefined {
  if ((harness !== "claude-code" && harness !== "codex") || typeof input !== "object" || input === null) return undefined;
  const { hook_event_name: event, session_id: session, cwd: folder, transcript_path: transcript, source, cursor_version: cursor } = input as Record<string, unknown>;
  if (typeof cursor === "string" || typeof session !== "string" || !SESSION.test(session)) return undefined;
  return {
    event, session, source,
    ...(typeof folder === "string" && folder !== "" ? { folder } : {}),
    ...(typeof transcript === "string" && transcript !== "" ? { transcript } : {}),
  };
}

export function toolsStoppedAtTurnEnd(harness: string, input: unknown, home: string): string | undefined {
  const { hook_event_name: event, stop_hook_active: again } = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (event !== "Stop" || again === true) return undefined;
  const notice = toolsStoppedNotice(harness, input, home);
  if (notice === undefined) return undefined;
  return JSON.stringify({ decision: "block", reason: notice.agent, ...(harness === "claude-code" ? { systemMessage: notice.user } : {}) });
}

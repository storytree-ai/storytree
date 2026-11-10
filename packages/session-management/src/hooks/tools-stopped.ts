/**
 * Capability 3 · Hooks, contract 3.57: a session whose storytree tools an update stopped is told so, once. The first Windows
 * update off a release from before the tool copies stops that release's agent tools (Updates 4.46), which ends every open
 * session's storytree tool server; neither Claude Code nor Codex starts it again by itself (increment_b80832695835's
 * research). The setup leaves a record in the storytree home when it stops one, the file's time being when. The hooks
 * still run, from the new files, so a Claude Code or Codex session in a storytree project that started before that time
 * is told, at its next prompt or turn end, why storytree's tools are gone and what the user should do.
 *
 * When a session started is the last startup or resume its own SessionStart hook saw (a resumed session starts its tool
 * server again; a compaction or a clear does not), or, for a session this release's hooks never saw start, its
 * transcript's creation. Where neither says, nothing is told.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { route } from "@storytree/project-and-caller";
import { notYetGivenIds } from "./given-once.js";

/** The record, in the storytree home, that an update's setup stopped storytree's tools; its modified time is when. apps/desktop/installer.nsh writes it. */
export const TOOLS_STOPPED = "tools-stopped";

const SESSION = /^[A-Za-z0-9._-]+$/;
const starts = () => path.join(tmpdir(), "storytree-session-starts");

/** At a Claude Code or Codex SessionStart that starts its tool server (a startup or a resume), remember when. Never throws. */
export function noteSessionStart(harness: string, input: unknown, now: number = Date.now()): void {
  const about = sessionOf(harness, input);
  if (about === undefined || about.event !== "SessionStart" || (about.source !== undefined && about.source !== "startup" && about.source !== "resume")) return;
  try {
    mkdirSync(starts(), { recursive: true });
    writeFileSync(path.join(starts(), `${about.session}.json`), JSON.stringify(now));
  } catch {
    // Unremembered, the transcript's creation stands in.
  }
}

/** What a hook tells a session whose tools an update stopped: for the agent, and for the user. */
export interface ToolsStoppedNotice {
  readonly agent: string;
  readonly user: string;
}

/** The notice `harness`'s session is due, at a prompt or a turn end, from the record in `home`; undefined when it is not due or was given. Never throws. */
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

/** When `session` started its tool server, as far as this machine can tell. */
function startOf(session: string, transcript: string | undefined): number | undefined {
  try {
    const noted: unknown = JSON.parse(readFileSync(path.join(starts(), `${session}.json`), "utf8"));
    if (typeof noted === "number") return noted;
  } catch {
    // Not seen starting by these hooks.
  }
  if (transcript === undefined) return undefined;
  const born = statSync(transcript, { throwIfNoEntry: false })?.birthtimeMs;
  return born === undefined || born <= 0 ? undefined : born;
}

/** The session a Claude Code or Codex hook input is about; undefined for any other harness or input. */
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

/** The Stop hook's output telling the agent, when its turn ends, that the update stopped its tools: a block whose reason it reads and carries on with. Undefined when not due. */
export function toolsStoppedAtTurnEnd(harness: string, input: unknown, home: string): string | undefined {
  const { hook_event_name: event, stop_hook_active: again } = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (event !== "Stop" || again === true) return undefined;
  const notice = toolsStoppedNotice(harness, input, home);
  if (notice === undefined) return undefined;
  return JSON.stringify({ decision: "block", reason: notice.agent, ...(harness === "claude-code" ? { systemMessage: notice.user } : {}) });
}

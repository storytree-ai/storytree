/**
 * Capability 3 · The caller: who made a tool call, read from what the harness sent with it and the line the hook
 * run just before it left (ADR-1025 D2). The MCP server's wrapper calls these on every call (ADR-0969 D1), with
 * the lines Session management's activity log gives it for the call (its callLines); they read only those lines.
 * Browser-safe: nothing here reads a file, the environment or the log.
 */
import type { Agent, Line } from "@storytree/library";
import { watchedHarness } from "./harnesses.js";

/** The session calling, as the harness names it. */
export interface Caller {
  readonly session: string;
  readonly harness?: string;
}

/** What the harness sent with a call beside its arguments: its `_meta`. */
export type CallMeta = Readonly<Record<string, unknown>>;

/** A line's own "who": the session and, when known, its harness. */
export function lineOf(caller: Caller): { session: string; harness?: string } {
  return caller.harness === undefined ? { session: caller.session } : { session: caller.session, harness: caller.harness };
}

/**
 * Which of the session's agents made a call (ADR-0629 D2), from what the harness revealed and
 * nothing else, as the 2026-09-26 probe of Claude Code 2.1.283 and Codex 0.155 found it:
 * - the line the hook before the call left under the call's id (`_meta["claudecode/toolUseId"]`,
 *   Codex's `_meta.callId`), which is all Claude Code reveals: it shares one tool server between
 *   the orchestrator and its subagents;
 * - else, for Codex, the call's own thread: the session's (`sessionId`) is the orchestrator's, any
 *   other a subagent's own id;
 * - a subagent's type and task from the line its start left, when there is one.
 * Otherwise "unknown": never worked out from timing or transcripts.
 */
export function agentOf(lines: readonly Line[], meta: CallMeta): Agent {
  const agent = requestOf(lines, meta)?.agent ?? threadAgent(meta) ?? "unknown";
  if (typeof agent === "string") return agent;
  const started = lines.findLast((line): line is Extract<Line, { kind: "subagent-started" }> => line.kind === "subagent-started" && line.subagent === agent.subagent);
  const type = agent.type ?? started?.type;
  const task = agent.task ?? started?.task;
  return { subagent: agent.subagent, ...(type === undefined ? {} : { type }), ...(task === undefined ? {} : { task }) };
}

/**
 * The calling session as the hook before the call named it, when one did. After Claude Code's
 * /clear the window is a new session that only its hooks see, while the server keeps the id it was
 * started with; a call no hook saw keeps the id the harness gave the server.
 */
export function seenCaller(lines: readonly Line[], caller: Caller, meta: CallMeta): Caller {
  const requested = requestOf(lines, meta);
  return requested === undefined ? caller : { ...caller, session: requested.session };
}

/**
 * The line the hook before a call left, found by the call's id: Claude Code's `_meta["claudecode/toolUseId"]`,
 * Codex's `_meta.callId`. A call with no id is from a harness that sends none (Cursor, Pi, Antigravity CLI): its
 * line is the newest that harness left among the lines given, which the activity log found by its harness, tool and time.
 */
export function requestOf(lines: readonly Line[], meta: CallMeta): Extract<Line, { kind: "tool-requested" }> | undefined {
  const call = callOf(meta);
  return lines.findLast((line): line is Extract<Line, { kind: "tool-requested" }> => line.kind === "tool-requested" && (call === undefined ? watchedHarness(line.harness)?.callIds === false : line.call === call));
}

/** The call's id, as the harness gave it. */
export function callOf(meta: CallMeta): string | undefined {
  return text(meta["claudecode/toolUseId"]) ?? text(meta.callId);
}

/** Codex names the thread making each call beside its session: the session's own thread is its orchestrator. */
function threadAgent(meta: CallMeta): Agent | undefined {
  const thread = text(meta.threadId);
  const session = text(meta.sessionId);
  if (thread === undefined || session === undefined) return undefined;
  return thread === session ? "orchestrator" : { subagent: thread };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

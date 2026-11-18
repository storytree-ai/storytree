// Capability 3 · The caller
import type { Agent, Line } from "@storytree/library";
import { watchedHarness } from "./harnesses.js";

export interface Caller {
  readonly session: string;
  readonly harness?: string;
}

export type CallMeta = Readonly<Record<string, unknown>>;

export function lineOf(caller: Caller): { session: string; harness?: string } {
  return caller.harness === undefined ? { session: caller.session } : { session: caller.session, harness: caller.harness };
}

export function agentOf(lines: readonly Line[], meta: CallMeta): Agent {
  const agent = requestOf(lines, meta)?.agent ?? threadAgent(meta) ?? "unknown";
  if (typeof agent === "string") return agent;
  const started = lines.findLast((line): line is Extract<Line, { kind: "subagent-started" }> => line.kind === "subagent-started" && line.subagent === agent.subagent);
  const type = agent.type ?? started?.type;
  const task = agent.task ?? started?.task;
  return { subagent: agent.subagent, ...(type === undefined ? {} : { type }), ...(task === undefined ? {} : { task }) };
}

export function seenCaller(lines: readonly Line[], caller: Caller, meta: CallMeta): Caller {
  const requested = requestOf(lines, meta);
  return requested === undefined ? caller : { ...caller, session: requested.session };
}

export function requestOf(lines: readonly Line[], meta: CallMeta): Extract<Line, { kind: "tool-requested" }> | undefined {
  const call = callOf(meta);
  return lines.findLast((line): line is Extract<Line, { kind: "tool-requested" }> => line.kind === "tool-requested" && (call === undefined ? watchedHarness(line.harness)?.callIds === false : line.call === call));
}

export function callOf(meta: CallMeta): string | undefined {
  return text(meta["claudecode/toolUseId"]) ?? text(meta.callId);
}

function threadAgent(meta: CallMeta): Agent | undefined {
  const thread = text(meta.threadId);
  const session = text(meta.sessionId);
  if (thread === undefined || session === undefined) return undefined;
  return thread === session ? "orchestrator" : { subagent: thread };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

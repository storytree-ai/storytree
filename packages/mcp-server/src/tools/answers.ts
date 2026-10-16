/** Capability 6 · Agent tools (the MCP server). How the tools' answers are sent, and how a failure becomes one. */
import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  ConnectionError,
  DependencyLoopError,
  LifecycleError,
  MissingReferenceError,
  NewerSchemaError,
  ProjectNameError,
  RetireRefusedError,
  SchemaError,
  UnknownTypeError,
  WaitLoopError,
} from "@storytree/library";

import { CaptureError } from "@storytree/session-management";
import { ProjectFolderError } from "@storytree/project-and-caller";

/** A tool's answer: one plain sentence (or a few lines), what it made or found as data, and whether it refused. */
export interface Answer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
  readonly refused?: boolean;
}

/** What every tool answers while storytree is not running. */
export const NOT_RUNNING_ANSWER = "storytree isn't running, carry on without it";

/**
 * The answer as the harness gets it: the sentence as text, and any data beside it, carrying the
 * sentence too. A harness may show the agent the data rather than the text (Claude Code 2.1.212
 * does), and the sentence is what the agent acts on.
 */
export function result(answer: Answer): CallToolResult {
  return {
    content: [{ type: "text", text: answer.text }],
    ...(answer.data === undefined ? {} : { structuredContent: { message: answer.text, ...answer.data } }),
    ...(answer.refused === true ? { isError: true } : {}),
  };
}

/** The library's and the claims' own refusals, as against a failure. */
function isRefusal(error: unknown): boolean {
  const refusals = [MissingReferenceError, SchemaError, DependencyLoopError, UnknownTypeError, NewerSchemaError, ProjectNameError, ProjectFolderError, ConnectionError, LifecycleError, WaitLoopError, RetireRefusedError, CaptureError];
  return refusals.some((kind) => error instanceof kind);
}

/** A refusal the agent can read: the library's own message for the refusals it makes, said plainly otherwise. */
export function refusalOf(error: unknown): string {
  if (isRefusal(error)) return `storytree refused that: ${(error as Error).message}`;
  return `storytree could not do that: ${error instanceof Error ? error.message : String(error)}`;
}

/** How a tool's call went, as its `door-answered` line records it (ADR-0983 D1). */
export interface DoorOutcome {
  readonly outcome: "answered" | "refused" | "failed" | "denied-by-arm";
  readonly class?: string;
  readonly next: string[];
}

/** An answer the tool gave: refused or answered, with the next steps its data offered, as the tool door names them. */
export function outcomeOf(answer: Answer): DoorOutcome {
  const offered = Array.isArray(answer.data?.next) ? answer.data.next as unknown[] : [];
  const next = offered.flatMap((one) => typeof one === "object" && one !== null && typeof (one as { step?: unknown }).step === "string" ? [(one as { step: string }).step] : []);
  return { outcome: answer.refused === true ? "refused" : "answered", next };
}

/** A tool that threw: refused, for the library's and the claims' refusals, else failed; with the error's class. */
export function failureOf(error: unknown): DoorOutcome {
  const named = error instanceof Error ? error.name : undefined;
  return { outcome: isRefusal(error) ? "refused" : "failed", ...(named === undefined || named === "" ? {} : { class: named }), next: [] };
}

/** Storytree could not be reached, or went away: the connection failed, dropped or timed out. */
export function isUnreachable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const codes = ["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006"];
  return (typeof code === "string" && codes.includes(code)) || (typeof message === "string" && /Connection terminated|timeout exceeded when trying to connect/.test(message));
}

/** The library is down: unreachable, timed out, or its Cloud SQL instance stopped. A lookup that can do without it falls back. */
export function libraryDown(error: unknown): boolean {
  return isUnreachable(error) || (error instanceof ConnectionError && (error.problem === "timeout" || error.problem === "stopped"));
}

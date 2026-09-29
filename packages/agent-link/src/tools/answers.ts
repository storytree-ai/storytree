/** How the tools' answers are sent, and how a failure becomes one. */
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

import { CaptureError } from "../capture/index.js";
import { ProjectFolderError } from "../routing/index.js";

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

/** A refusal the agent can read: the library's own message for the refusals it makes, said plainly otherwise. */
export function refusalOf(error: unknown): string {
  const refusals = [MissingReferenceError, SchemaError, DependencyLoopError, UnknownTypeError, NewerSchemaError, ProjectNameError, ProjectFolderError, ConnectionError, LifecycleError, WaitLoopError, RetireRefusedError, CaptureError];
  if (refusals.some((kind) => error instanceof kind)) return `storytree refused that: ${(error as Error).message}`;
  return `storytree could not do that: ${error instanceof Error ? error.message : String(error)}`;
}

/** Storytree could not be reached, or went away: the connection failed, dropped or timed out. */
export function isUnreachable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const codes = ["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006"];
  return (typeof code === "string" && codes.includes(code)) || (typeof message === "string" && /Connection terminated|timeout exceeded when trying to connect/.test(message));
}

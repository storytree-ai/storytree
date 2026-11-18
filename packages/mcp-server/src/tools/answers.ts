// Capability 6 · Tool server (the MCP server)
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

import { ProjectFolderError } from "@storytree/project-and-caller";

export interface Answer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
  readonly refused?: boolean;
}

export const NOT_RUNNING_ANSWER = "storytree isn't running, carry on without it";

export function result(answer: Answer): CallToolResult {
  return {
    content: [{ type: "text", text: answer.text }],
    ...(answer.data === undefined ? {} : { structuredContent: { message: answer.text, ...answer.data } }),
    ...(answer.refused === true ? { isError: true } : {}),
  };
}

function isRefusal(error: unknown): boolean {
  const refusals = [MissingReferenceError, SchemaError, DependencyLoopError, UnknownTypeError, NewerSchemaError, ProjectNameError, ProjectFolderError, ConnectionError, LifecycleError, WaitLoopError, RetireRefusedError];
  return refusals.some((kind) => error instanceof kind);
}

export function refusalOf(error: unknown): string {
  if (isRefusal(error)) return `storytree refused that: ${(error as Error).message}`;
  return `storytree could not do that: ${error instanceof Error ? error.message : String(error)}`;
}

export interface DoorOutcome {
  readonly outcome: "answered" | "refused" | "failed" | "denied-by-arm";
  readonly class?: string;
  readonly next: string[];
}

export function outcomeOf(answer: Answer): DoorOutcome {
  const offered = Array.isArray(answer.data?.next) ? answer.data.next as unknown[] : [];
  const next = offered.flatMap((one) => typeof one === "object" && one !== null && typeof (one as { step?: unknown }).step === "string" ? [(one as { step: string }).step] : []);
  return { outcome: answer.refused === true ? "refused" : "answered", next };
}

export function failureOf(error: unknown): DoorOutcome {
  const named = error instanceof Error ? error.name : undefined;
  return { outcome: isRefusal(error) ? "refused" : "failed", ...(named === undefined || named === "" ? {} : { class: named }), next: [] };
}

export function isUnreachable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const codes = ["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006"];
  return (typeof code === "string" && codes.includes(code)) || (typeof message === "string" && /Connection terminated|timeout exceeded when trying to connect/.test(message));
}

export function libraryDown(error: unknown): boolean {
  return isUnreachable(error) || (error instanceof ConnectionError && (error.problem === "timeout" || error.problem === "unreachable"));
}

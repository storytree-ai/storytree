// Capability 3 · Hooks
import type { NewLine } from "@storytree/library";

import type { ActivityLog } from "../activity/index.js";

const LONGEST = 300;

const READS_THE_WEB: Readonly<Record<string, string>> = { WebFetch: "url", WebSearch: "query" };

const OUTSIDE_SERVER = /^mcp__.*(github|gmail)/i;

const READING_COMMANDS: readonly RegExp[] = [
  /\bgh\s+(issue|pr)\s+(view|diff|list)\b/,
  /\bgh\s+api\b[^|;&]*\/(issues|pulls|comments)\b/,
  /\b(curl|wget)\b[^|;&]*https?:\/\/(?!(localhost|127\.0\.0\.1|\[::1\])[:/])/,
];

export function outsideTextRead(tool: string, input: Record<string, unknown>): string | undefined {
  const field = READS_THE_WEB[tool];
  if (field !== undefined) return typeof input[field] === "string" && input[field] !== "" ? cut(`${tool} ${input[field]}`) : cut(tool);
  if (OUTSIDE_SERVER.test(tool)) return cut(tool);
  const { command } = input;
  return typeof command === "string" && READING_COMMANDS.some((pattern) => pattern.test(command)) ? cut(command) : undefined;
}

export function outsideTextLine(common: Pick<NewLine, "session" | "harness" | "source" | "folder">, tool: unknown, input: unknown): NewLine | undefined {
  if (typeof tool !== "string" || typeof input !== "object" || input === null) return undefined;
  const what = outsideTextRead(tool, input as Record<string, unknown>);
  return what === undefined ? undefined : { ...common, kind: "outside-text-read", what };
}

const MARKED = 20;

export async function outsideTextReads(log: Pick<ActivityLog, "lines">, project: string, session: string): Promise<string[]> {
  const lines = await log.lines(project, { sessions: [session], kinds: ["outside-text-read"], latestBy: ["what"], newest: MARKED });
  return lines.flatMap((line) => (line.kind === "outside-text-read" ? [line.what] : []));
}

function cut(text: string): string {
  return text.trim().slice(0, LONGEST);
}

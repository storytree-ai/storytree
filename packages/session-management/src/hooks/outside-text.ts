/**
 * Capability 3 · Hooks (3.49). Which tool calls read outside text: text from anyone but the session's owner, which the
 * published memory-poisoning attacks (MINJA, AgentPoison, SpAIware) plant to have an agent write it into its memory. A
 * fetched page, a web search, a GitHub or Gmail tool, or a shell command reading an issue, a pull request or a web page.
 * Each such call makes an `outside-text-read` line, and a later knowledge write by the session carries what it read.
 */
import type { NewLine } from "@storytree/library";

import type { ActivityLog } from "../activity/index.js";

/** How long what was read may be, as a line keeps it: a command's or a URL's first 300 characters. */
const LONGEST = 300;

/** The harness tools that read the web. */
const READS_THE_WEB: Readonly<Record<string, string>> = { WebFetch: "url", WebSearch: "query" };

/** An MCP tool from a GitHub or Gmail server, as Claude Code names it (`mcp__<server>__<tool>`). */
const OUTSIDE_SERVER = /^mcp__.*(github|gmail)/i;

/** Shell commands that read an issue, a pull request or its comments, or fetch a page that is not on this machine. */
const READING_COMMANDS: readonly RegExp[] = [
  /\bgh\s+(issue|pr)\s+(view|diff|list)\b/,
  /\bgh\s+api\b[^|;&]*\/(issues|pulls|comments)\b/,
  /\b(curl|wget)\b[^|;&]*https?:\/\/(?!(localhost|127\.0\.0\.1|\[::1\])[:/])/,
];

/** What a tool call read from outside, as its line names it, or undefined when it read nothing from outside. */
export function outsideTextRead(tool: string, input: Record<string, unknown>): string | undefined {
  const field = READS_THE_WEB[tool];
  if (field !== undefined) return typeof input[field] === "string" && input[field] !== "" ? cut(`${tool} ${input[field]}`) : cut(tool);
  if (OUTSIDE_SERVER.test(tool)) return cut(tool);
  const { command } = input;
  return typeof command === "string" && READING_COMMANDS.some((pattern) => pattern.test(command)) ? cut(command) : undefined;
}

/** The line a tool call that read outside text makes, beside whatever line the call made already. */
export function outsideTextLine(common: Pick<NewLine, "session" | "harness" | "source" | "folder">, tool: unknown, input: unknown): NewLine | undefined {
  if (typeof tool !== "string" || typeof input !== "object" || input === null) return undefined;
  const what = outsideTextRead(tool, input as Record<string, unknown>);
  return what === undefined ? undefined : { ...common, kind: "outside-text-read", what };
}

/** How many of a session's reads a write's mark names at most: the newest. */
const MARKED = 20;

/**
 * What `session` has read from outside, as its hooks recorded it: each read once, the newest MARKED. A front door hands
 * this to the library as its writer's `outsideRead`, which asks for it only on a write to a marked knowledge kind.
 */
export async function outsideTextReads(log: Pick<ActivityLog, "lines">, project: string, session: string): Promise<string[]> {
  const lines = await log.lines(project, { sessions: [session], kinds: ["outside-text-read"], latestBy: ["what"], newest: MARKED });
  return lines.flatMap((line) => (line.kind === "outside-text-read" ? [line.what] : []));
}

function cut(text: string): string {
  return text.trim().slice(0, LONGEST);
}

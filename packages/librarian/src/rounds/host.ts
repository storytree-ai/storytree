/**
 * Capability 6 · Rounds. The MCP server's extension point (its ToolExtension, ADR-0643 D6, ADR-0969 D1), as far as
 * the librarian's tools use it. Restated rather than imported: the MCP server depends on this package to serve
 * these tools, and no story may depend on the MCP server (ADR-0969 D1). The MCP server checks the two still
 * fit where it registers librarianTools; where the verb's own types live is ADR-0969 D2's work.
 */
import type { Library, WriteOptions } from "@storytree/library";
import type { z } from "zod";

/** One line of the agent activity log, as far as a session's start is read from it. */
interface ActivityLine {
  readonly kind: string;
  readonly session: string;
  readonly harness?: string | undefined;
  readonly at: string;
}

/** What the librarian asks of the log: the lines a bounded read names (the agent link's contract 2.7), never the whole log. */
interface LineAsk {
  readonly kinds?: readonly "session-started"[];
  readonly sessions?: readonly string[];
  readonly where?: Readonly<Record<string, string | null>>;
  readonly oldest?: number;
  readonly omit?: readonly string[];
}

/** What a tool has to work with for one call. */
export interface ToolCall {
  readonly library: Library;
  readonly log: { lines(project: string, filter: LineAsk): Promise<readonly ActivityLine[]> };
  readonly project: string;
  readonly caller: { readonly session: string; readonly harness?: string };
  readonly writer: WriteOptions;
  readonly folder: string;
  /** Names the phase a slow tool is in; rejects once the client has cancelled, so no further phase starts. */
  readonly progress?: (message: string) => Promise<void>;
}

/** What a tool answers. */
export interface ToolAnswer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
  readonly refused?: boolean;
}

/** Registers one tool: its name, what it is for, its arguments, and what it does with them. */
export type DefineTool = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: ToolCall) => Promise<ToolAnswer>) => void;

/** The librarian's contribution to the agent link's one tool server. */
export interface ToolExtension {
  readonly registerTools?: (define: DefineTool) => void;
  readonly instructions?: string;
  readonly landNext?: (capability: string, call: ToolCall) => Promise<string | undefined> | string | undefined;
}

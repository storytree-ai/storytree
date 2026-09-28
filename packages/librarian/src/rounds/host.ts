/**
 * The agent link's extension point (its ToolExtension, ADR-0643 D6), as far as the librarian's
 * tools use it. Restated rather than imported: the agent link depends on this package to serve
 * these tools, and a dependency back would make a workspace cycle, which pnpm turns into a loop of
 * directory junctions on Windows that `git clean` never finishes walking. The agent link checks the
 * two still fit where it registers librarianTools.
 */
import type { Library, WriteOptions } from "@storytree/library";
import type { z } from "zod";

/** One line of the agent activity log, as far as a session's start is read from it. */
interface ActivityLine {
  readonly kind: string;
  readonly session: string;
  readonly harness?: string;
  readonly at: string;
}

/** What a tool has to work with for one call. */
export interface ToolCall {
  readonly library: Library;
  readonly log: { since(project: string, cursor: number): Promise<{ lines: readonly ActivityLine[] }> };
  readonly project: string;
  readonly caller: { readonly session: string; readonly harness?: string };
  readonly writer: WriteOptions;
  readonly folder: string;
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

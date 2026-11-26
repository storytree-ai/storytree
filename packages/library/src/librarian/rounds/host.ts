// Capability 26 · Rounds
import type { WriteOptions } from "../../records/index.js";
import type { LibrarianLibrary } from "../notes.js";
import type { z } from "zod";

interface ActivityLine {
  readonly kind: string;
  readonly session: string;
  readonly harness?: string | undefined;
  readonly at: string;
}

interface LineAsk {
  readonly kinds?: readonly "session-started"[];
  readonly sessions?: readonly string[];
  readonly where?: Readonly<Record<string, string | null>>;
  readonly oldest?: number;
  readonly omit?: readonly string[];
}

export interface ToolCall {
  readonly library: LibrarianLibrary;
  readonly log: { lines(project: string, filter: LineAsk): Promise<readonly ActivityLine[]> };
  readonly project: string;
  readonly caller: { readonly session: string; readonly harness?: string };
  readonly writer: WriteOptions;
  readonly folder: string;
  readonly progress?: (message: string) => Promise<void>;
  readonly pluginKinds?: readonly string[];
}

export interface ToolAnswer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
  readonly refused?: boolean;
}

export type DefineTool = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: ToolCall) => Promise<ToolAnswer>, options?: { readonly consumers?: readonly ("agent" | "user")[]; readonly writes?: true }) => void;

export interface ToolExtension {
  readonly registerTools?: (define: DefineTool) => void;
  readonly instructions?: string;
  readonly landNext?: (capability: string, call: ToolCall) => Promise<string | undefined> | string | undefined;
}

export interface ToolHost {
  readonly project: string | undefined;
  readonly tools: () => readonly string[];
}

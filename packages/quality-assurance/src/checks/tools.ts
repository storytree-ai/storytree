/**
 * Capability 1 · Quality control checks: the checks reading as a tool on the MCP server's one server, through
 * its extension point (its ToolExtension, ADR-0643 D6, ADR-0969 D1). The extension's shape is restated rather
 * than imported, as the librarian's is: no story may depend on the MCP server, which depends on this
 * package to serve the tool, and checks the two still fit where it registers qualityTools.
 */
import type { Library } from "@storytree/library";
import { z } from "zod";

import { checks, checksText } from "./checks.js";

/** What a tool has to work with for one call, as far as the checks reading needs it. */
interface ToolCall {
  readonly library: Library;
}

/** What a tool answers. */
interface ToolAnswer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
}

/** Registers one tool: its name, what it is for, its arguments, and what it does with them. */
type DefineTool = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: ToolCall) => Promise<ToolAnswer>) => void;

/** Quality assurance's contribution to the MCP server's one tool server. */
export interface ToolExtension {
  readonly registerTools?: (define: DefineTool) => void;
  readonly instructions?: string;
}

/** The tools this story serves on the MCP server: the checks reading (contract 1.2). */
export function qualityTools(): ToolExtension {
  return {
    registerTools(define) {
      define("quality_checks", "Read every live quality control check: the yes-or-no question a reviewer answers about a finished change, and the principle or guardrail notes it enforces.", z.object({}), async (_args, { library }) => {
        const reading = await checks(library);
        return { text: checksText(reading), data: { checks: reading } };
      });
    },
  };
}

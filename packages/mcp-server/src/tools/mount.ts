/**
 * Capability 6 · Agent tools (the MCP server). A verb its owning story declared once (ADR-0969 D2), mounted as a
 * tool: its schema is read from the verb's inputs, the calling session's context is the wrapper's, a step its
 * answer names is called by its tool's name, and the verb's own refusal is an answer marked as an error. A verb
 * whose tool is declared absent is not served. Tools give no next-step lines yet (ADR-0786 D6).
 */

import { z } from "zod";

import { currentBranch } from "@storytree/agent-link";
import { mounted, toolInput, VerbRefusal, type DoorWords, type Verb, type VerbInput } from "@storytree/agent-link/verbs";

import { lineOf, type Define } from "./server.js";

const WORDS: DoorWords = {
  door: "tool",
  say: (step) => step.tool ?? `storytree ${step.command!}`,
};

function schemaOf(input: VerbInput): z.ZodType {
  if (input.kind === "text") return z.string().min(1).describe(input.describe);
  const yes = z.boolean().describe(input.describe);
  return input.kind === "switch" ? yes.optional() : yes;
}

/** Serve each of `verbs` that has a tool. `home` is the storytree home its ledger and claims are kept under, when not the usual one. */
export function mountTools(define: Define, verbs: readonly Verb[], home?: string): void {
  for (const declared of verbs) {
    if (!mounted(declared.tool)) continue;
    const input = z.object(Object.fromEntries(Object.entries(declared.inputs).map(([name, one]) => [name, schemaOf(one)])));
    define(declared.tool.name, declared.tool.description, input, async (args, { log, library, project, caller, folder, writer }) => {
      const branch = currentBranch(folder);
      try {
        const answer = await declared.act(toolInput(declared, args), {
          log, library, project, ...lineOf(caller), folder, writer,
          ...(branch === undefined ? {} : { branch }),
          ...(home === undefined ? {} : { home }),
        }, WORDS);
        return { text: answer.text, ...(answer.data === undefined ? {} : { data: answer.data }) };
      } catch (error) {
        if (error instanceof VerbRefusal) return { text: error.message, refused: true };
        throw error;
      }
    });
  }
}

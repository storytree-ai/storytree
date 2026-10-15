/**
 * Capability 6 · Agent tools (the MCP server). A verb its owning story declared once (ADR-0969 D2), mounted as a
 * tool: its schema is read from the verb's inputs, the calling session's context is the wrapper's, a step its
 * answer names is called by its tool's name, and the verb's own refusal is an answer marked as an error. A verb
 * whose tool is declared absent is not served, and one that is is served with its consumers (ADR-1045 D1). The steps it offers next are named as tools, below its sentence as the
 * command line prints them and in its data too, for a harness that shows the agent the data (ADR-0786 D2, as the owner
 * answered question_c7a7d394adf9).
 */

import { z } from "zod";

import type { Line } from "@storytree/library";
import type { NoteRead, NoteToolContext } from "@storytree/library/commands";
import { currentBranch, presentersOf, readClaims } from "@storytree/session-management";
import { consumersOf, mounted, VerbRefusal, type DoorWords, type Verb, type VerbAnswer, type VerbInput, type VerbInputs } from "@storytree/library/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";

import { lineOf, type Answer, type Call, type Define } from "./server.js";
import { toolInput } from "./tool-input.js";

const WORDS: DoorWords = {
  door: "tool",
  say: (step) => step.tool ?? `storytree ${step.command!}`,
};

/** The verb's answer as a tool's: its next steps named as tools, one to a line under `next:`, and in its data. */
function answerOf(answer: VerbAnswer): Answer {
  const next = (answer.next ?? []).map((step) => ({ step: WORDS.say(step), why: step.why }));
  if (next.length === 0) return { text: answer.text, ...(answer.data === undefined ? {} : { data: answer.data }) };
  const width = Math.max(...next.map(({ step }) => step.length));
  const lines = next.map(({ step, why }) => `  - ${step.padEnd(width)}   (${why})`);
  return { text: `${answer.text.replace(/\s+$/, "")}\n\nnext:\n${lines.join("\n")}`, data: { ...answer.data, next } };
}

function schemaOf(input: VerbInput): z.ZodType {
  if (input.kind === "text") {
    const one = z.string().min(1);
    const text = (input.many ? z.array(one) : one).describe(input.describe);
    return input.optional ? text.optional() : text;
  }
  if (input.kind === "fields") return z.record(z.string(), input.json ? z.unknown() : z.string()).optional().describe(input.describe);
  if (input.kind === "count") {
    const count = z.number().int().min(1).describe(input.describe);
    return input.optional ? count.optional() : count;
  }
  const yes = z.boolean().describe(input.describe);
  return input.kind === "switch" ? yes.optional() : yes;
}

/** What this door hands a mounted verb: the caller's context with the activity log, and what the library's artifact tools read. */
export type ToolContext = SessionVerbContext & NoteToolContext;

/** The calling session's artifact reads, oldest first: its own note-read lines alone (contract 2.7). */
async function notesRead({ log, project, caller }: Call): Promise<NoteRead[]> {
  const lines = await log.lines(project, { kinds: ["note-read"], sessions: [caller.session], omit: ["transcript"] });
  return lines.filter((line): line is Extract<Line, { kind: "note-read" }> => line.kind === "note-read").map(({ note, found, read }) => ({ note, found, read }));
}

/** Record each read on the calling session, naming the agent that made it (ADR-0629 D2) and the hook line that caused it. */
async function recordReads(call: Call, reads: readonly NoteRead[]): Promise<void> {
  for (const read of reads) {
    await call.log.append(call.project, { ...lineOf(call.caller), source: "tool", folder: call.folder, kind: "note-read", ...read, agent: call.agent, ...(call.request === undefined ? {} : { causedBy: call.request }) });
  }
}

/**
 * Serve each of `verbs` that has a tool, handing it the caller's context with the activity log, the project's claims,
 * and the calling session's artifact reads. `home` is the storytree home its ledger and claims are kept under, when
 * not the usual one.
 */
export function mountTools(define: Define, verbs: readonly Verb<VerbInputs, ToolContext>[], home?: string): void {
  for (const declared of verbs) {
    if (!mounted(declared.tool)) continue;
    const input = z.object(Object.fromEntries(Object.entries(declared.inputs).map(([name, one]) => [name, schemaOf(one)])));
    define(declared.tool.name, declared.tool.description, input, async (args, call) => {
      const { log, library, project, caller, folder, writer } = call;
      const branch = currentBranch(folder);
      try {
        return answerOf(await declared.act(toolInput(declared, args), {
          log, library, project, ...lineOf(caller), folder, writer,
          ...(branch === undefined ? {} : { branch }),
          ...(home === undefined ? {} : { home }),
          claims: () => readClaims(log, project, { quietMs: call.quietMs }),
          notesRead: () => notesRead(call),
          recordReads: (reads) => recordReads(call, reads),
          presenterOf: async (question) => (await presentersOf(log, project, [question])).get(question.id),
        }, WORDS));
      } catch (error) {
        if (error instanceof VerbRefusal) return { text: error.message, refused: true };
        throw error;
      }
    }, { consumers: consumersOf(declared) });
  }
}

// Capability 6 · Tool server (the MCP server)

import { z } from "zod";

import type { Line } from "@storytree/library";
import { placeFiles } from "@storytree/map/code-survey";
import type { NoteRead, NoteToolContext } from "@storytree/library/commands";
import { currentBranch, presentersOf, readClaims } from "@storytree/session-management";
import { consumersOf, mounted, VerbRefusal, type DoorWords, type Verb, type VerbAnswer, type VerbFamilies, type VerbInput, type VerbInputs } from "@storytree/library/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";
import type { Composition } from "@storytree/plugin-loader";
import type { ProvidingFamily } from "@storytree/plugin-loader/switch";

import { lineOf, type Answer, type Call, type Define } from "./server.js";
import { toolInput } from "./tool-input.js";

const WORDS: DoorWords = {
  door: "tool",
  say: (step) => step.tool ?? `storytree ${step.command!}`,
};

function answerOf(answer: VerbAnswer): Answer {
  const next = (answer.next ?? []).map((step) => ({ step: WORDS.say(step), why: step.why }));
  if (next.length === 0) return { text: answer.text, ...(answer.data === undefined ? {} : { data: answer.data }) };
  const width = Math.max(...next.map(({ step }) => step.length));
  const lines = next.map(({ step, why }) => `  - ${step.padEnd(width)}   (${why})`);
  return { text: `${answer.text.trimEnd()}\n\nnext:\n${lines.join("\n")}`, data: { ...answer.data, next } };
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

export type ToolContext = SessionVerbContext & NoteToolContext & {
  hostVerbs?(): Promise<Composition<ProvidingFamily>>;
};

async function notesRead({ log, project, caller }: Call): Promise<NoteRead[]> {
  const lines = await log.lines(project, { kinds: ["note-read"], sessions: [caller.session], omit: ["transcript"] });
  return lines.filter((line): line is Extract<Line, { kind: "note-read" }> => line.kind === "note-read").map(({ note, found, read }) => ({ note, found, read }));
}

async function recordReads(call: Call, reads: readonly NoteRead[]): Promise<void> {
  for (const read of reads) {
    await call.log.append(call.project, { ...lineOf(call.caller), source: "tool", folder: call.folder, kind: "note-read", ...read, agent: call.agent, ...(call.request === undefined ? {} : { causedBy: call.request }) });
  }
}

export function verbsOf(family: VerbFamilies<ToolContext>): Verb<VerbInputs, ToolContext>[] {
  return [...family.verbs, ...(family.bare === undefined ? [] : [family.bare]), ...(family.families ?? []).flatMap(verbsOf)];
}

export function mountTools(define: Define, verbs: readonly Verb<VerbInputs, ToolContext>[], home?: string, composed?: Composition<ProvidingFamily>): void {
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
          ...(composed === undefined ? {} : { hostVerbs: async () => composed }),
          claims: () => readClaims(log, project, { quietMs: call.quietMs }),
          placeFiles: async (paths) => placeFiles(folder, paths, await library.projectTree()),
          notesRead: () => notesRead(call),
          recordReads: (reads) => recordReads(call, reads),
          presenterOf: async (question) => (await presentersOf(log, project, [question])).get(question.id),
        }, WORDS));
      } catch (error) {
        if (error instanceof VerbRefusal) return { text: error.message, refused: true };
        throw error;
      }
    }, { consumers: consumersOf(declared), ...(declared.writes ? { writes: true } : {}) });
  }
}

// Capability 26 · Rounds
import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { annotate, correct, supersede } from "../../decisions/index.js";
import { retire } from "../catalogue.js";
import { claudeCodeMemoryFolder, graduate, park } from "../graduation.js";
import { link } from "../links.js";
import type { ToolCall, ToolExtension, ToolHost } from "./host.js";
import { roundDue, worklist, worklistView } from "./rounds.js";

const PASS = "run the librarian's pass";

const INSTRUCTIONS = "The librarian: `worklist` lists what needs curating; `link`, `supersede`, `correct`, `annotate` and `retire` keep the notes true; `park` or `graduate` each memory it lists.";

function present<T extends object>(fields: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

async function sinceOf(call: ToolCall): Promise<number | undefined> {
  const lines = await call.log.lines(call.project, { kinds: ["session-started"], sessions: [call.caller.session], oldest: 1 });
  const start = lines.find(({ kind, session }) => kind === "session-started" && session === call.caller.session);
  if (start === undefined) return undefined;
  const [first] = await call.library.history({ from: start.at, oldest: 1 });
  if (first !== undefined) return first.seq - 1;
  const [last] = await call.library.history({ newest: 1 });
  return last?.seq ?? 0;
}

const successor = z.union([
  z.string(),
  z.object({
    title: z.string(),
    text: z.string(),
    links: z.array(z.string()).optional(),
    frontCoverOf: z.string().optional(),
    loadBearing: z.boolean().optional(),
  }),
]);

export function librarianTools({ tools }: { tools?: () => readonly string[] } = {}): ToolExtension {
  return {
    instructions: INSTRUCTIONS,
    async landNext(_capability, call) {
      const due = await roundDue(call.library, { ...present({ since: await sinceOf(call) }), ...(call.pluginKinds === undefined ? {} : { pluginKinds: call.pluginKinds }) });
      return due.rest || (due.plugins ?? []).length > 0 ? PASS : undefined;
    },
    registerTools(define) {
      define(
        "worklist",
        "The librarian's worklist: the memories to graduate and, when the session wrote a curated note, the links, health, catalogue, processes and questions to curate, each list's first five named with how many it holds.",
        z.object({ memoryFolders: z.array(z.string()).optional(), tools: z.array(z.string()).optional() }),
        async (args, call) => {
          const since = await sinceOf(call);
          const served = args.tools ?? tools?.();
          const full = await worklist(call.library, {
            ...present({ since }),
            memoryFolders: args.memoryFolders ?? [claudeCodeMemoryFolder(path.resolve(call.folder), homedir())],
            ...(served === undefined ? {} : { tools: served }),
            ...(call.progress === undefined ? {} : { progress: call.progress }),
            ...(call.pluginKinds === undefined ? {} : { pluginKinds: call.pluginKinds }),
          });
          const view = worklistView(full);
          const counts = view.rest?.counts;
          const said = counts === undefined
            ? "no curated note was written since the session started, so only graduation is due"
            : Object.entries(counts).map(([list, count]) => `${list} ${count}`).join(", ");
          return { text: `The librarian's worklist: ${view.graduation.length} memories to graduate; ${said}.`, data: { worklist: view } };
        },
      );
      define(
        "link",
        "Make one note, or a question, rest on another note; why is the justification a decision linking a decision needs.",
        z.object({ from: z.string(), to: z.string(), why: z.string().optional() }),
        async ({ from, to, why }, call) => {
          const linked = await link(call.library, from, to, call.writer, why);
          return { text: `${from} rests on ${to}.`, data: { id: linked.id } };
        },
        { writes: true },
      );
      define(
        "supersede",
        "Record that a successor decision, new or existing, supersedes the old ones, with a justification for each.",
        z.object({ olds: z.array(z.string()).min(1), successor, justifications: z.record(z.string(), z.string()).optional() }),
        async (args, call) => {
          const next = typeof args.successor === "string" ? args.successor : present(args.successor);
          const written = await supersede(call.library, [...new Set(args.olds)], next, call.writer, args.justifications ?? {});
          return { text: `${written.id} supersedes ${[...new Set(args.olds)].join(", ")}.`, data: { id: written.id } };
        },
        { writes: true },
      );
      define(
        "correct",
        "Correct a decision in place: its text, title or load-bearing mark.",
        z.object({
          id: z.string(),
          fields: z.object({ text: z.string().optional(), title: z.string().optional(), loadBearing: z.boolean().optional(), status: z.enum(["proposed", "accepted"]).optional() }),
        }),
        async ({ id, fields }, call) => {
          const corrected = await correct(call.library, id, present(fields), call.writer);
          return { text: `${corrected.id} was corrected.`, data: { id: corrected.id } };
        },
        { writes: true },
      );
      define(
        "annotate",
        "Note on a decision that another narrows it, naming the clauses, with why for the narrowing.",
        z.object({ target: z.string(), by: z.string(), note: z.string(), date: z.string().optional(), clauses: z.array(z.string()).optional(), why: z.string().optional() }),
        async ({ target, ...annotation }, call) => {
          const annotated = await annotate(call.library, target, present(annotation), call.writer);
          return { text: `${annotated.id} was annotated.`, data: { id: annotated.id } };
        },
        { writes: true },
      );
      define(
        "retire",
        "Retire a note nothing live points at.",
        z.object({ id: z.string(), reason: z.string() }),
        async ({ id, reason }, call) => {
          await retire(call.library, id, reason, call.writer);
          return { text: `${id} was retired.`, data: { id } };
        },
        { writes: true },
      );
      define(
        "park",
        "Keep a memory out of the library for now, with the reason, beside its folder.",
        z.object({ memory: z.string(), reason: z.string() }),
        async ({ memory, reason }) => {
          await park(memory, reason);
          return { text: `${memory} was parked.`, data: { memory } };
        },
      );
      define(
        "graduate",
        "Write a memory's lesson as a principle, process or definition, then delete the memory.",
        z.object({ memory: z.string(), kind: z.string(), fields: z.record(z.string(), z.unknown()) }),
        async ({ memory, kind, fields }, call) => {
          const note = await graduate(call.library, memory, kind, fields, call.writer);
          return { text: `${memory} graduated as ${note.id}.`, data: { id: note.id } };
        },
        { writes: true },
      );
    },
  };
}

export const librarianToolParts: (({ project, tools }: ToolHost) => ToolExtension | undefined)[] = [
  ({ project, tools }) => (project === "storytree" ? librarianTools({ tools }) : undefined),
];

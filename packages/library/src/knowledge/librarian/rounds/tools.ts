// Capability 26 · Rounds
import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { retire } from "../catalogue.js";
import { annotate, correct, supersede } from "../../index.js";
import { claudeCodeMemoryFolder, graduate, park } from "../graduation.js";
import { link } from "../links.js";
import type { ToolCall, ToolExtension, ToolHost } from "./host.js";
import { roundDue, worklist, worklistView } from "./rounds.js";

const text = z.string().trim().min(1);

export const librarianToolParts = [({ project, tools }: ToolHost): ToolExtension | undefined => (project === "storytree" ? librarianTools({ tools }) : undefined)];

export function librarianTools({ tools }: { tools?: () => readonly string[] } = {}): ToolExtension {
  return {
    instructions: "Before landing, use `worklist` for the librarian's pass: `link`, `supersede`, `correct` (including load-bearing), `annotate`, `retire`, `park` and `graduate`; graduate durable memory every time. Friction drains apart, through `friction_drain` and `route`.",
    async landNext(_capability, call) {
      const due = await roundDue(call.library, { ...await sessionStart(call), ...pluginKinds(call) });
      return due.rest || (due.plugins?.length ?? 0) > 0 ? "run the librarian's pass" : undefined;
    },
    registerTools(define) {
      define("worklist", "Gather the librarian's worklist since this session started: graduation always, other curation when due. The friction drain is friction_drain's. Memory folders default to Claude Code's for this folder; name other folders explicitly.", z.object({
        memoryFolders: z.array(text).optional(),
        tools: z.array(text).optional().describe("Tools served, for matching processes; defaults to this server's catalogue when supplied by the host"),
      }), async (args, call) => {
        const served = args.tools ?? tools?.();
        const full = await worklist(call.library, {
          ...await sessionStart(call),
          memoryFolders: args.memoryFolders?.map((folder) => path.resolve(call.folder, folder)) ?? [claudeCodeMemoryFolder(call.folder, homedir())],
          ...(served === undefined ? {} : { tools: served }),
          ...pluginKinds(call),
          ...(call.progress === undefined ? {} : { progress: call.progress }),
        });
        return { text: "The librarian's worklist. Review graduation at every landing; each other list shows its first few, with counts: read any note whole by its ID.", data: { worklist: worklistView(full) } };
      }, { consumers: ["agent"] });
      define("link", "Make one note rest on another, preserving its existing links. A definition rests only on the decision that created its term. A question, open or settled, links the evidence it cites this way: a note, decision, research, increment or another question. A decision linking a decision gives why: at most two lines, why an agent would follow it and why it was linked.", z.object({ from: text, to: text, why: text.optional() }), async ({ from, to, why }, { library, writer }) => {
        const note = await link(library, from, to, writer, why);
        return { text: `${from} rests on ${to}.`, data: { id: note.id } };
      }, { writes: true });
      define("supersede", "Record an accepted successor, or name an existing accepted decision by ID, when the decision changed; inherit the old shelf if it has none and the load-bearing mark. Use correct when only the wording changed.", z.object({
        olds: z.array(text).min(1), successor: z.union([text.describe("An existing accepted decision's ID"), z.object({ title: text, text, frontCoverOf: text.optional() })]),
        justifications: z.record(z.string(), text).optional().describe("Each old decision's id, to why the successor supersedes it: at most two lines"),
      }), async ({ olds, successor, justifications }, { library, writer }) => {
        const note = await supersede(library, olds, typeof successor === "string" ? successor : defined(successor), writer, justifications);
        return { text: `${note.id} supersedes ${olds.join(", ")}.`, data: { id: note.id } };
      }, { writes: true });
      define("correct", "Correct a decision in place without changing what was decided, or mark/unmark it load-bearing. Only the owner can turn accepted back to proposed.", z.object({
        id: text, fields: z.object({ title: text.optional(), text: text.optional(), loadBearing: z.boolean().optional(), status: z.enum(["proposed", "accepted"]).optional() }),
      }), async ({ id, fields }, { library, writer }) => {
        const note = await correct(library, id, defined(fields), writer);
        return { text: `Corrected ${id} in place.`, data: { id: note.id } };
      }, { writes: true });
      define("annotate", "Leave a dated annotation in the decision a newer decision supersedes in part, naming that newer decision and the clauses it supersedes (D2, D3); with no clauses named, the supersession is partial.", z.object({ target: text, by: text, note: text, date: text.optional(), clauses: z.array(text).optional(), why: text.optional().describe("Why the newer decision supersedes these clauses: at most two lines") }), async ({ target, ...annotation }, { library, writer }) => {
        const note = await annotate(library, target, defined(annotation), writer);
        return { text: `Annotated ${target}.`, data: { id: note.id } };
      }, { writes: true });
      define("retire", "Retire a finished note with a reason, only when no live record points at it. Questions use settle_question or retire_question.", z.object({ id: text, reason: text }), async ({ id, reason }, { library, writer }) => {
        await retire(library, id, reason, writer);
        return { text: `Retired ${id}: ${reason}.`, data: { id } };
      }, { writes: true });
      define("park", "Keep a reviewed memory with its reason for 60 days; a change to the memory brings it back sooner.", z.object({ memory: text, reason: text }), async ({ memory, reason }, call) => {
        const file = path.resolve(call.folder, memory);
        await park(file, reason);
        return { text: `Parked ${file}: ${reason}.`, data: { memory: file } };
      });
      define("graduate", "Write a durable memory as a principle, process or definition, then delete its memory file. A refused write keeps the memory.", z.object({
        memory: text, kind: z.enum(["principle", "process", "definition"]), fields: z.record(z.string(), z.unknown()),
      }), async ({ memory, kind, fields }, call) => {
        const note = await graduate(call.library, path.resolve(call.folder, memory), kind, fields, call.writer);
        return { text: `Graduated ${memory} into ${note.id}.`, data: { id: note.id } };
      }, { writes: true });
    },
  };
}

async function sessionStart(call: ToolCall): Promise<{ since?: number }> {
  const [start] = await call.log.lines(call.project, { kinds: ["session-started"], sessions: [call.caller.session], where: { harness: call.caller.harness ?? null }, oldest: 1, omit: ["transcript"] });
  if (start === undefined) return {};
  const [newest] = await call.library.history({ newest: 1 });
  const [first] = await call.library.history({ from: start.at, oldest: 1 });
  return { since: first === undefined ? (newest?.seq ?? 0) : first.seq - 1 };
}

function pluginKinds(call: ToolCall): { pluginKinds?: readonly string[] } {
  return call.pluginKinds === undefined ? {} : { pluginKinds: call.pluginKinds };
}

function defined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

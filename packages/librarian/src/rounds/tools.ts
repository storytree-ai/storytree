/** Capability 6 · Rounds. Rounds 6.3–6.4: curation on the agent link's shared server, through its public extension point. */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { retire } from "../catalogue/index.js";
import { annotate, correct, supersede } from "../decision-log/index.js";
import { claudeCodeMemoryFolder, graduate, park } from "../graduation/index.js";
import { link } from "../links/index.js";
import { route } from "../queues/index.js";
import type { ToolCall, ToolExtension } from "./host.js";
import { roundDue, worklist } from "./rounds.js";

const text = z.string().trim().min(1);

/** The server supplies its discovered tool names; another host can supply the same catalogue. */
export function librarianTools({ tools }: { tools?: () => readonly string[] } = {}): ToolExtension {
  return {
    instructions: "Before landing, use `worklist` for the librarian's pass: `link`, `supersede`, `correct` (including load-bearing), `annotate`, `retire`, `park`, `graduate`, and `route`; graduate durable memory every time.",
    async landNext(_capability, call) {
      return (await roundDue(call.library, await sessionStart(call))).rest ? "run the librarian's pass" : undefined;
    },
    registerTools(define) {
      define("worklist", "Gather the librarian's worklist since this session started: graduation and the friction drain always, other curation when due. Memory folders default to Claude Code's for this folder; name other folders explicitly.", z.object({
        memoryFolders: z.array(text).optional(),
        tools: z.array(text).optional().describe("Tools served, for matching processes; defaults to this server's catalogue when supplied by the host"),
      }), async (args, call) => {
        const branch = branchIn(call.folder);
        const served = args.tools ?? tools?.();
        return { text: "The librarian's worklist. Review graduation at every landing.", data: { worklist: await worklist(call.library, {
          ...await sessionStart(call),
          ...(branch === undefined ? {} : { branch }),
          memoryFolders: args.memoryFolders?.map((folder) => path.resolve(call.folder, folder)) ?? [claudeCodeMemoryFolder(call.folder, homedir())],
          ...(served === undefined ? {} : { tools: served }),
        }) } };
      });
      define("link", "Make one note rest on another, preserving its existing links. A definition rests only on the decision that created its term.", z.object({ from: text, to: text }), async ({ from, to }, { library, writer }) => {
        const note = await link(library, from, to, writer);
        return { text: `${from} rests on ${to}.`, data: { id: note.id } };
      });
      define("supersede", "Record an accepted successor, or name an existing accepted decision by ID, when the decision changed; inherit the old shelf if it has none and the load-bearing mark. Use correct when only the wording changed.", z.object({
        olds: z.array(text).min(1), successor: z.union([text.describe("An existing accepted decision's ID"), z.object({ title: text, text, frontCoverOf: text.optional() })]),
      }), async ({ olds, successor }, { library, writer }) => {
        const note = await supersede(library, olds, typeof successor === "string" ? successor : defined(successor), writer);
        return { text: `${note.id} supersedes ${olds.join(", ")}.`, data: { id: note.id } };
      });
      define("correct", "Correct a decision in place without changing what was decided, or mark/unmark it load-bearing. Only the owner can turn accepted back to proposed.", z.object({
        id: text, fields: z.object({ title: text.optional(), text: text.optional(), loadBearing: z.boolean().optional(), status: z.enum(["proposed", "accepted"]).optional() }),
      }), async ({ id, fields }, { library, writer }) => {
        const note = await correct(library, id, defined(fields), writer);
        return { text: `Corrected ${id} in place.`, data: { id: note.id } };
      });
      define("annotate", "Leave a dated annotation in the decision a newer decision narrows, naming that newer decision.", z.object({ target: text, by: text, note: text, date: text.optional() }), async ({ target, ...annotation }, { library, writer }) => {
        const note = await annotate(library, target, defined(annotation), writer);
        return { text: `Annotated ${target}.`, data: { id: note.id } };
      });
      define("retire", "Retire a finished note with a reason, only when no live record points at it. Questions use settle_question or retire_question.", z.object({ id: text, reason: text }), async ({ id, reason }, { library, writer }) => {
        await retire(library, id, reason, writer);
        return { text: `Retired ${id}: ${reason}.`, data: { id } };
      });
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
      });
      define("route", "Record the librarian's routing judgement and reason on friction, or add its delivery stamp later. A tool route needs an open increment naming this friction in remedies, unless the remedy is already stamped as delivered.", z.object({
        friction: text, route: z.enum(["adr", "tool", "principle", "guardrail", "process", "definition", "edit-existing", "nothing"]), reason: text,
        dischargedBy: text.optional().describe("Reference to the remedy that landed, such as a PR or decision; omit to preserve any existing stamp"),
      }), async ({ friction, route: to, reason, dischargedBy }, { library, writer }) => {
        const note = await route(library, friction, to, reason, { ...writer, ...defined({ dischargedBy }) });
        return { text: `Routed ${friction} to ${to}: ${reason}.`, data: { id: note.id } };
      });
    },
  };
}

/**
 * Recover the library cursor at the calling session's first start from its timed activity line.
 * A resume is still that session. No recorded start means unsure, so roundDue fires. An equal
 * millisecond stays after the cursor too: uncertainty must never hide a curated write.
 */
async function sessionStart(call: ToolCall): Promise<{ since?: number }> {
  // The session's first start line alone, never the rest of the log (agent link 2.7).
  const [start] = await call.log.lines(call.project, { kinds: ["session-started"], sessions: [call.caller.session], where: { harness: call.caller.harness ?? null }, oldest: 1, omit: ["transcript"] });
  if (start === undefined) return {};
  // Two changes, never the whole history (contract 6.6): the newest, read first so that a change
  // written between the reads still lands after the cursor, and the first made since the start.
  const [newest] = await call.library.history({ newest: 1 });
  const [first] = await call.library.history({ from: start.at, oldest: 1 });
  return { since: first === undefined ? (newest?.seq ?? 0) : first.seq - 1 };
}

function branchIn(folder: string): string | undefined {
  try {
    return execFileSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3_000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Schema optionals arrive as undefined; domain writes omit them unless the caller supplied one. */
function defined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

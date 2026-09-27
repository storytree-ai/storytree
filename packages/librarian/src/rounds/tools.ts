/** Rounds 6.3–6.4: curation on the agent link's shared server, through its public extension point. */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

import type { ToolCall, ToolExtension } from "@storytree/agent-link";
import { z } from "zod";

import { retire } from "../catalogue/index.js";
import { annotate, correct, supersede } from "../decision-log/index.js";
import { claudeCodeMemoryFolder, graduate, park } from "../graduation/index.js";
import { link } from "../links/index.js";
import { route } from "../queues/index.js";
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
      define("worklist", "Gather the librarian's worklist since this session started: graduation always, other curation when due. Memory folders default to Claude Code's for this folder; name other folders explicitly.", z.object({
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
      define("supersede", "Record an accepted successor when the decision changed; inherit its shelf and load-bearing mark. Use correct when only the wording changed.", z.object({
        olds: z.array(text).min(1), successor: z.object({ title: text, text, frontCoverOf: text.optional() }),
      }), async ({ olds, successor }, { library, writer }) => {
        const note = await supersede(library, olds, defined(successor), writer);
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
      define("route", "Record the librarian's routing judgement and reason on a friction report from the worklist.", z.object({
        friction: text, route: z.enum(["adr", "tool", "principle", "guardrail", "process", "definition", "edit-existing", "nothing"]), reason: text,
      }), async ({ friction, route: to, reason }, { library, writer }) => {
        const note = await route(library, friction, to, reason, writer);
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
  const { lines } = await call.log.since(call.project, 0);
  const start = lines.find((line) => line.kind === "session-started" && line.session === call.caller.session && line.harness === call.caller.harness);
  if (start === undefined) return {};
  let since = 0;
  for (const change of await call.library.history()) {
    if (change.at >= start.at) break;
    since = change.seq;
  }
  return { since };
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

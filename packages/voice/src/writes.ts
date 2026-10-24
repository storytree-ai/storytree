/**
 * Capability 5 · Drafted writes with read-back and undo (contracts 5.1-5.4, 5.6-5.8): the voice writes, each a signed tool.
 * save_note keeps what the owner said at once, an answer to a question included (ADR-1155 D1, D2), and start_manager_run
 * drafts one session manager run on the box that carries every unswept note (ADR-1150); confirm sets a draft to take
 * effect ten minutes later, cancel stops it until then, and lock_voice turns every write off until the box clears it.
 * Each write checks the lock first. None runs anything itself: the box's committer (commit.ts) starts a run, and the run
 * sweeps the notes.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { voiceSession } from "./config.js";
import { DraftRefusal, Drafts, NOTE_KINDS, WORDS_CHARS, managerBrief, spokenAnswer, type Draft } from "./drafts.js";

/** The write tools, each of which needs the owner's sign-in. */
export const WRITE_TOOL_NAMES = ["save_note", "start_manager_run", "confirm", "cancel", "lock_voice"] as const;

/** An open question's id and title, or null when it is not open; read through the storytree command line. */
export type OpenQuestion = (id: string) => Promise<{ id: string; title: string } | null>;

type Result = { content: Array<{ type: "text"; text: string }>; isError?: true };
const said = (text: string): Result => ({ content: [{ type: "text", text }] });
const refused = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });

const QUESTION_ID = /^question_[0-9a-f]{12}$/;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const UNDO = "Say confirm to go ahead: it takes effect ten minutes after you confirm, and cancel stops it until then. Unconfirmed, it lapses in 15 minutes.";

function words(text: unknown): string {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat === "") throw new DraftRefusal("say what to write: his words as he said them");
  if (flat.length > WORDS_CHARS) throw new DraftRefusal(`that is longer than ${WORDS_CHARS} characters; say it more shortly`);
  return flat;
}

function when(at: Date): string {
  return `${at.toISOString().slice(11, 16)} UTC`;
}

/** The one pending draft a confirm or cancel without a number means, or a refusal asking which. */
async function meant(drafts: Drafts, draft: number | undefined, which: (pending: Draft[]) => Draft[]): Promise<number> {
  if (draft !== undefined) return draft;
  const pending = which(await drafts.pending());
  if (pending.length === 0) throw new DraftRefusal("there is no draft waiting");
  if (pending.length > 1) throw new DraftRefusal(`which one? drafts ${pending.map((each) => each.id).join(", ")} are waiting`);
  return pending[0]!.id;
}

/** Register the write tools; the door has verified the owner's sign-in before any of them runs. */
export function registerWriteTools(server: McpServer, drafts: Drafts, openQuestion: OpenQuestion, log: (line: string) => void): void {
  const guarded = async (body: () => Promise<Result>, { lockFirst = true } = {}): Promise<Result> => {
    try {
      if (lockFirst) {
        const lock = await drafts.locked();
        if (lock !== null) return refused(`voice writes are locked (${lock}); only the box can turn them back on`);
      }
      return await body();
    } catch (error) {
      if (error instanceof DraftRefusal) return refused(error.message);
      log(`write tool error: ${(error as Error | undefined)?.name ?? "Error"}`);
      return refused("the write failed unexpectedly; nothing was changed");
    }
  };

  server.registerTool(
    "save_note",
    {
      title: "Save a note",
      description:
        "Keep one thing the owner said, in his words as he said them, at once: no read-back and nothing to confirm. Its kind is what it is: " +
        "a decision, a change he wants, an idea, a question he asks, an instruction, or an answer to one of his open questions (give its id " +
        "from catch_up). A session manager run sweeps the notes when he says to send them, and acts on each. Needs the owner's sign-in.",
      inputSchema: z.object({
        text: z.string().max(WORDS_CHARS * 2).describe("what he said, word for word as transcribed"),
        kind: z.enum(NOTE_KINDS).describe("what the note is"),
        question: z.string().max(80).optional().describe("for an answer only: the question's id, for example question_403f67807848"),
      }),
      annotations: WRITE,
    },
    async ({ text, kind, question }) =>
      guarded(async () => {
        const session = voiceSession(new Date());
        const spoken = words(text);
        const named = String(question ?? "").trim().toLowerCase();
        if (kind !== "answer") {
          if (named !== "") throw new DraftRefusal("only an answer names a question; save this without one");
          const note = await drafts.add({ kind: "note", noteKind: kind, words: spoken, body: spoken, session });
          return said(`Noted, number ${note.id}.`);
        }
        if (!QUESTION_ID.test(named)) throw new DraftRefusal("which question does he answer? give its id from catch_up, such as question_403f67807848");
        const open = await openQuestion(named);
        if (open === null) throw new DraftRefusal(`${named} is not an open question; save what he said as another kind of note`);
        const note = await drafts.add({ kind: "note", noteKind: "answer", question: named, words: spoken, body: spokenAnswer(spoken, session), session });
        return said(`Noted, number ${note.id}: his answer to "${open.title}". The manager settles it when he sends his notes. — ${named}`);
      }),
  );

  server.registerTool(
    "start_manager_run",
    {
      title: "Start a session manager run (a draft)",
      description:
        "Draft starting one session manager run on the Mint box for the owner's request, in his words as he said them: research, parking work, " +
        "raising questions, steering sessions in progress. The run's brief is written by the door, quoting his words; add nothing of your own. " +
        "It carries every note not yet swept. One voice-started run at a time; its reply comes back under Replies ready in catch_up. " +
        "Nothing starts until he confirms. Needs the owner's sign-in.",
      inputSchema: z.object({
        request: z.string().max(WORDS_CHARS * 2).describe("his request, word for word as transcribed"),
      }),
      annotations: { ...WRITE, openWorldHint: true },
    },
    async ({ request }) =>
      guarded(async () => {
        const spoken = words(request);
        const active = await drafts.activeRun();
        if (active !== null) {
          const state = active.committed_at ? "running" : active.confirmed_at ? "waiting to start" : "drafted";
          throw new DraftRefusal(`one voice-started run at a time: draft ${active.id} is ${state}; cancel it first, or wait for its reply`);
        }
        const session = voiceSession(new Date());
        const notes = await drafts.unswept();
        const draft = await drafts.add({ kind: "manager_run", words: spoken, body: managerBrief(spoken, session, notes), session });
        const carried = notes.length === 0 ? "with no notes waiting" : `with the ${notes.length === 1 ? "note" : `${notes.length} notes`} waiting`;
        return said(`Draft ${draft.id}: start a session manager run on the Mint box for his words, ${carried}: "${spoken}"\n${UNDO}`);
      }),
  );

  server.registerTool(
    "confirm",
    {
      title: "Confirm a draft",
      description:
        "Confirm a draft the owner has heard read back and said yes to. It takes effect ten minutes later unless he cancels. " +
        "Without draft it confirms the one unconfirmed draft, or asks which. Needs the owner's sign-in.",
      inputSchema: z.object({ draft: z.number().int().min(1).optional().describe("the draft's number, as read back") }),
      annotations: WRITE,
    },
    async ({ draft }) =>
      guarded(async () => {
        const id = await meant(drafts, draft, (pending) => pending.filter((each) => each.confirmed_at === null));
        const confirmed = await drafts.confirm(id);
        return said(`Draft ${id} confirmed: it takes effect at ${when(confirmed.commit_at!)}, unless he says cancel before then.`);
      }),
  );

  server.registerTool(
    "cancel",
    {
      title: "Cancel a draft",
      description:
        "Cancel a draft before it takes effect (\"cancel that\"). Without draft it cancels the newest waiting draft. Works while writes are locked. Needs the owner's sign-in.",
      inputSchema: z.object({ draft: z.number().int().min(1).optional().describe("the draft's number, as read back") }),
      annotations: { ...WRITE, destructiveHint: true },
    },
    async ({ draft }) =>
      guarded(async () => {
        const id = await meant(drafts, draft, (pending) => pending.slice(0, 1));
        await drafts.cancel(id);
        return said(`Draft ${id} cancelled: nothing of it will happen.`);
      }, { lockFirst: false }),
  );

  server.registerTool(
    "lock_voice",
    {
      title: "Turn voice writes off",
      description:
        "Turn every voice write off at once, for example when the owner says to stop. Drafts not yet carried out are dropped. Voice cannot turn writes " +
        "back on: only the box's own account can. Needs the owner's sign-in.",
      inputSchema: z.object({ reason: z.string().max(400).optional().describe("why, in a few words") }),
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    async ({ reason }) =>
      guarded(async () => {
        const why = String(reason ?? "").replace(/\s+/g, " ").trim() || "the owner said to stop";
        await drafts.lock(`lock_voice: ${why}`.slice(0, 500));
        return said("Voice writes are off. Nothing waiting will be carried out, and only the box can turn writes back on.");
      }, { lockFirst: false }),
  );
}

/** catch_up's replies: what each run of the last day came to, newest first. */
export async function repliesSaid(drafts: Drafts): Promise<string[]> {
  return (await drafts.replies()).map((draft) => `Draft ${draft.id}, the run you asked for: ${draft.reply ?? draft.outcome ?? "it ended without a reply"}`);
}

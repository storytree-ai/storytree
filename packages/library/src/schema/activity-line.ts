/**
 * Capability 3 · Data schema. The shape of a line of the agent activity log (Session management's capability 2): one for
 * each thing that happens, each about one agent session. A line is only ever added, never changed. The lines are stored
 * in the library's database, so their shape is defined here, the registry of shapes stories share (ADR-1017 D3):
 * Session management, which writes the log, and every story that reads it take it from here.
 */
import { z } from "zod";

/** Every line names the session it is about, and where it came from. */
const common = {
  /** The harness's own id for the session (one agent window). */
  session: z.string().min(1),
  /** Which harness the session runs in: `claude-code`, `codex`, or another that names itself. */
  harness: z.string().min(1).optional(),
  /** Written by a hook the harness ran by itself, or by a tool the agent chose to call. */
  source: z.enum(["hook", "tool"]),
  /** The folder the agent was working in. */
  folder: z.string().min(1).optional(),
  /**
   * The git branch that folder was on, when it was on one (ADR-0749 D2, ADR-0754 D4): a session's
   * branches are the ones its lines name. A `merged` line's branch is the claim's, not its writer's.
   */
  branch: z.string().min(1).optional(),
  /** The name of the machine the line was written on (ADR-0636 D1), as the log that wrote it was told it. */
  machine: z.string().min(1).optional(),
  /**
   * The session's transcript file, as the harness named it to the hook (`transcript_path`): where
   * its context reading is worked out from (Session management's capability 9, ADR-0725). Never found by folder.
   */
  transcript: z.string().min(1).optional(),
  /**
   * The number of the earlier line in the same project's log that caused this one (ADR-0746 D2),
   * stamped only by the code writing the line, when it has that line in hand as it writes. Never
   * worked out afterwards from timing, order or adjacency; a line without one reads "cause not
   * recorded", and nothing decides anything from it (D4).
   */
  causedBy: z.number().int().positive().optional(),
  /**
   * The experiment and arm whose lane wrote the line (ADR-1064 D2, D4), stamped by the log that wrote it as its
   * storytree home's settings name them, so an arm's lines are read apart from the rest. A line outside any experiment names neither.
   */
  experiment: z.string().min(1).optional(),
  arm: z.string().min(1).optional(),
};

/**
 * Which of a session's agents did something (ADR-0629 D2): its orchestrator, or one of its
 * subagents, by the harness's id for it, with its type and task when the harness has shown them.
 * "unknown" when the harness showed nothing. It is only ever what the harness revealed, never
 * worked out from timing or transcripts.
 */
const AGENT = z.union([
  z.literal("orchestrator"),
  z.literal("unknown"),
  z.object({ subagent: z.string().min(1), type: z.string().min(1).optional(), task: z.string().min(1).optional() }).strict(),
]);

/** Which of a session's agents did something: its orchestrator, a subagent, or unknown. */
export type Agent = z.infer<typeof AGENT>;

/** How a note was found, how much of it was read (ADR-0624, ADR-0627 D7), and which agent read it (ADR-0629 D2). */
const noteRead = {
  note: z.string().min(1),
  found: z.enum(["search", "link", "id", "shelf"]),
  read: z.enum(["peek", "whole"]),
  /** Reads recorded before ADR-0629 D2 landed name no agent. */
  agent: AGENT.optional(),
};

/**
 * What a claim is on: a capability, or an increment (ADR-0643 D1), exactly one. Lines written
 * before increment claims name a capability.
 */
const part = { capability: z.string().min(1).optional(), increment: z.string().min(1).optional() };
const onePart = (line: { capability?: string | undefined; increment?: string | undefined }) => (line.capability === undefined) !== (line.increment === undefined);
const ONE_PART = { message: "a claim is on a capability or an increment, exactly one" };
/** Why a taken-over holder no longer bound (ADR-0953 D2). */
const QUIET_BECAUSE = ["idle", "gone", "restart", "closed-out"] as const;

/** A line as it is written: what happened, without the number and time the log gives it. */
export const NEW_LINE = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("session-started"), how: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("session-ended"), reason: z.string().min(1).optional() }).strict(),
  /** A subagent the session started: the harness's id for it, its type, and the task it was given. */
  z.object({ ...common, kind: z.literal("subagent-started"), subagent: z.string().min(1), type: z.string().min(1).optional(), task: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("file-edited"), files: z.array(z.string().min(1)).min(1) }).strict(),
  /**
   * A shell command about to run: the harness's id for the call, which its finish line carries too.
   * Until that line, or the end of its turn, the command is running (Session management's capability 4), but never past
   * `limitMs`, the harness's own limit on a command, where the hook knew one other than its default.
   */
  z.object({ ...common, kind: z.literal("command-started"), command: z.string(), call: z.string().min(1), limitMs: z.number().int().positive().optional() }).strict(),
  /** A shell command that finished, whether it succeeded or failed: the call's id, where the harness gave one (lines written before ADR-0636 D2's fix carry none). */
  z.object({ ...common, kind: z.literal("command-run"), command: z.string(), call: z.string().min(1).optional() }).strict(),
  /** The user sent a prompt: the session works until its turn ends (ADR-0754 D5). The prompt's words are not kept. */
  z.object({ ...common, kind: z.literal("prompt-submitted") }).strict(),
  /**
   * The agent finished its turn, with how many background tasks it left running, where the harness
   * says (ADR-0754 D5). With none left running, no command it started in that turn still runs.
   */
  z.object({ ...common, kind: z.literal("turn-ended"), background: z.number().int().nonnegative().optional() }).strict(),
  /**
   * The session ended its work, saying whether it is safe to close and why (ADR-0758 D2). `running`
   * is how many of its own runs still ran on its machine, counted by the command that wrote the line,
   * never by the agent; absent when that reading was incomplete.
   */
  z.object({ ...common, kind: z.literal("closed-out"), safe: z.boolean(), why: z.string().min(1), running: z.number().int().nonnegative().optional() }).strict(),
  /** The session named itself (Session management's contract 6.32): what the running-sessions list calls its row, until it names itself again. */
  z.object({ ...common, kind: z.literal("session-named"), title: z.string().min(1) }).strict(),
  /** A hook saw an agent ask for one of storytree's tools, before the call reached the tool server: the call's id, as the harness names it, and the agent asking. */
  z.object({ ...common, kind: z.literal("tool-requested"), tool: z.string().min(1), call: z.string().min(1), agent: AGENT }).strict(),
  z.object({ ...common, kind: z.literal("tool-called"), tool: z.string().min(1) }).strict(),
  /**
   * A front door's answer (ADR-0983 D1, in force through ADR-0998): which door, the verb as that door
   * names it (a command, `storytree arc show`, or a tool, `show_plan`), how it went, and the next steps
   * it offered, each as that door names it. `unknown` is a command the door does not have: the `word`
   * typed and the command the refusal `named`, when it named one. `refused` is a guard's or the
   * library's "no", `failed` anything else, each with the error's `class` when one was thrown. `denied-by-arm` is a verb the
   * experiment arm the line names denies (ADR-1064 D2): refused before it ran, logged so a denied attempt is itself a measure.
   */
  z.object({ ...common, kind: z.literal("door-answered"), door: z.enum(["command", "tool"]), verb: z.string().min(1),
    outcome: z.enum(["answered", "unknown", "refused", "failed", "denied-by-arm"]), word: z.string().optional(), named: z.string().min(1).optional(),
    class: z.string().min(1).optional(), next: z.array(z.string().min(1)) }).strict(),
  z.object({ ...common, kind: z.literal("note-read"), ...noteRead }).strict(),
  /**
   * A claim taken, on the git branch its session's folder was on, when it was on one (ADR-0643 D3).
   * One storytree took because the session edited a file of the capability names that `file`, from
   * the checkout's root (ADR-0924 D1). A capability claim names the increment its session held
   * when it took it, `under`: that session closing the increment ends it (ADR-0944 D5). One taken
   * over names the holder it took from, when that holder was last seen and why it no longer bound (ADR-0953 D2).
   */
  z.object({ ...common, kind: z.literal("claimed"), ...part, reason: z.string().min(1), takenOverFrom: z.string().min(1).optional(),
    quietSince: z.string().datetime({ offset: true }).optional(), takenBecause: z.enum(QUIET_BECAUSE).optional(), file: z.string().min(1).optional(), under: z.string().min(1).optional() }).strict().refine(onePart, ONE_PART),
  /**
   * A claim turned away because another live session (`holder`) held the work: the reason the refused session gave, and the `file` whose edit asked for it (ADR-0924 D2).
   * A refused capability names the increment the refused session held, `under`, so the pool leaves that increment out while the holder keeps it.
   */
  z.object({ ...common, kind: z.literal("claim-refused"), ...part, holder: z.string().min(1), reason: z.string().min(1), file: z.string().min(1).optional(), under: z.string().min(1).optional() }).strict().refine(onePart, ONE_PART),
  /**
   * A claim let go. Written by its holder, it names no `holder`; written by the session manager for a quiet
   * session after messaging it (ADR-0944 D7), it names the `holder` whose claim it ends and the `reason`.
   */
  z.object({ ...common, kind: z.literal("released"), ...part, holder: z.string().min(1).optional(), reason: z.string().min(1).optional() }).strict().refine(onePart, ONE_PART),
  /**
   * The user's yes to changing imported code for an increment (ADR-1015, Session management's contract 5.41): the
   * capabilities its list named then, each with the folders and files it covered then. `how` says where the user gave it:
   * at the harness's own prompt before an edit (`prompt`, written by the hook after the edit it allowed), by a command
   * typed at their own terminal, never an agent's shell (`command`), or as the allow command on its own line of their own
   * message in the conversation (`said`, written by the prompt hook that heard it, for that session alone). No tool writes one.
   */
  z.object({ ...common, kind: z.literal("user-allowed"), increment: z.string().min(1), how: z.enum(["prompt", "command", "said"]),
    capabilities: z.array(z.object({ capability: z.string().min(1), covers: z.array(z.string().min(1)) }).strict()) }).strict(),
  z.object({ ...common, kind: z.literal("landed"), capability: z.string().min(1) }).strict(),
  /** An increment closed through storytree, with what the close meant: it ends any claim on it (ADR-0643 D1, 6). */
  z.object({ ...common, kind: z.literal("closed"), increment: z.string().min(1), disposition: z.enum(["landed", "failed", "withdrawn"]) }).strict(),
  /**
   * A pull request from a claim's branch merged after the claim was taken, which ends it (ADR-0643
   * D3): the claim's holder, and the pull request. Written by whichever session saw it, never on
   * the holder's own session, so it makes no idle holder read as live.
   */
  z.object({ ...common, kind: z.literal("merged"), ...part, holder: z.string().min(1), branch: z.string().min(1), pr: z.number().int().positive() }).strict().refine(onePart, ONE_PART),
  /**
   * Whether a branch (`of`) still holds open work (ADR-0754 D4): resolved once a pull request from
   * it merged, it has nothing ahead of the default branch, or it was deleted; open again when work
   * is added after. Written by whichever session saw it, never on the sessions that worked on it,
   * and the latest line for a branch is its state. A branch no line has resolved is open.
   * Resolved as merged, `pr` is the pull request that merged it. Open, `pr` is its open pull request
   * (Session management's contract 4.24), with whether it is a draft, its checks, and whether it waits in the merge queue
   * (`draft` and `queued` written only when true); a line written again when any of them changes.
   * Lines are read back unparsed, so a reader that predates these fields reads such a line as it did.
   */
  z.object({ ...common, kind: z.literal("branch-state"), of: z.string().min(1), open: z.boolean(), how: z.enum(["merged", "not-ahead", "deleted", "ahead"]), pr: z.number().int().positive().optional(),
    draft: z.literal(true).optional(), checks: z.enum(["pending", "passing", "failing"]).optional(), queued: z.literal(true).optional() }).strict(),
  /**
   * What a folder (`of`) on the main line holds, as a look on the machine the line names found it
   * (ADR-0906): whether its working tree has uncommitted changes, and whether its repository has no
   * commit yet (`unborn`, written only when true). Written by whichever session looked, never on the
   * sessions that worked there, and only when it changes; the latest line for a folder on a machine is its state.
   */
  z.object({ ...common, kind: z.literal("main-state"), of: z.string().min(1), dirty: z.boolean(), unborn: z.literal(true).optional() }).strict(),
  /**
   * A session (`of`) the Claude or Codex app keeps in its own record, archived there, or not (on
   * first sight, or un-archived) (ADR-0754 D4). Read from the app's files on the machine it runs on
   * and written by whichever session read them, never on the session it is about.
   */
  z.object({ ...common, kind: z.literal("session-archived"), of: z.string().min(1), app: z.enum(["claude-desktop", "codex"]) }).strict(),
  z.object({ ...common, kind: z.literal("session-unarchived"), of: z.string().min(1), app: z.enum(["claude-desktop", "codex"]) }).strict(),
  /**
   * The machine the line names started (`startedAt`, by its own clock), written once by the first
   * hook to reach the log after each start, never on the session that wrote it: a session last seen
   * on that machine before then died with it, and reads gone on every machine (Session management 4.29).
   */
  z.object({ ...common, kind: z.literal("machine-started"), machine: z.string().min(1), startedAt: z.string().datetime({ offset: true }) }).strict(),
  /**
   * How the app that keeps a session (`of`) names and describes it (Session management 4.19): its title, and
   * Claude's latest post-turn status, scrubbed. Written as the archive lines are, when either changes.
   */
  z.object({ ...common, kind: z.literal("session-described"), of: z.string().min(1), app: z.enum(["claude-desktop", "codex"]),
    title: z.string().min(1).optional(), status: z.string().min(1).optional() }).strict(),
  /**
   * How long hooks on the machine the line names took (ADR-1056 D1), uploaded in a batch by the look around the machine:
   * each reading's harness, event (with its flags), start, total from process start to exit and its parts, in ms. A
   * machine's cost, never its writer's work: written on the uploading session, which it never makes read live.
   */
  z.object({ ...common, kind: z.literal("hook-times"), readings: z.array(z.object({ at: z.string().datetime({ offset: true }), harness: z.string().min(1), event: z.string().min(1),
    total: z.number().nonnegative(), parts: z.object({ startup: z.number().nonnegative().optional(), connect: z.number().nonnegative().optional(),
      write: z.number().nonnegative().optional(), handoff: z.number().nonnegative().optional() }).strict() }).strict()).min(1).max(500) }).strict(),
]);

/** A line as it is written. */
export type NewLine = z.infer<typeof NEW_LINE>;
/** What happened, by kind. */
export type LineKind = NewLine["kind"];

/** A line as the log keeps it: numbered, timed, and under its project. */
export type Line = NewLine & {
  /** Its place in the log: strictly increasing within a project, not necessarily by one. Passed back as a cursor, it reads what came after it. */
  seq: number;
  project: string;
  /** When it was written, as an ISO 8601 timestamp. */
  at: string;
};

/** What reading the log returns: the lines after the cursor given, oldest first, and the cursor to pass next time. */
export interface LinesSince {
  lines: Line[];
  /** The last line's number, or the cursor given when there are no newer lines. */
  cursor: number;
}

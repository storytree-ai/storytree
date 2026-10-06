/**
 * The lines of the agent activity log (capability 2): one for each thing that happens, each about
 * one agent session. A line is only ever added, never changed.
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
   * its context reading is worked out from (capability 9, ADR-0725). Never found by folder.
   */
  transcript: z.string().min(1).optional(),
  /**
   * The number of the earlier line in the same project's log that caused this one (ADR-0746 D2),
   * stamped only by the code writing the line, when it has that line in hand as it writes. Never
   * worked out afterwards from timing, order or adjacency; a line without one reads "cause not
   * recorded", and nothing decides anything from it (D4).
   */
  causedBy: z.number().int().positive().optional(),
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

/** A line as it is written: what happened, without the number and time the log gives it. */
export const NEW_LINE = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("session-started"), how: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("session-ended"), reason: z.string().min(1).optional() }).strict(),
  /** A subagent the session started: the harness's id for it, its type, and the task it was given. */
  z.object({ ...common, kind: z.literal("subagent-started"), subagent: z.string().min(1), type: z.string().min(1).optional(), task: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("file-edited"), files: z.array(z.string().min(1)).min(1) }).strict(),
  /**
   * A shell command about to run: the harness's id for the call, which its finish line carries too.
   * Until that line, or the end of its turn, the command is running (capability 4), but never past
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
  /** The session named itself (contract 6.32): what the running-sessions list calls its row, until it names itself again. */
  z.object({ ...common, kind: z.literal("session-named"), title: z.string().min(1) }).strict(),
  /** A hook saw an agent ask for one of storytree's tools, before the call reached the tool server: the call's id, as the harness names it, and the agent asking. */
  z.object({ ...common, kind: z.literal("tool-requested"), tool: z.string().min(1), call: z.string().min(1), agent: AGENT }).strict(),
  z.object({ ...common, kind: z.literal("tool-called"), tool: z.string().min(1) }).strict(),
  z.object({ ...common, kind: z.literal("note-read"), ...noteRead }).strict(),
  /**
   * A claim taken, on the git branch its session's folder was on, when it was on one (ADR-0643 D3).
   * One storytree took because the session edited a file of the capability names that `file`, from
   * the checkout's root (ADR-0924 D1).
   */
  z.object({ ...common, kind: z.literal("claimed"), ...part, reason: z.string().min(1), takenOverFrom: z.string().min(1).optional(), file: z.string().min(1).optional() }).strict().refine(onePart, ONE_PART),
  /** A claim turned away because another live session (`holder`) held the work: the reason the refused session gave, and the `file` whose edit asked for it (ADR-0924 D2). */
  z.object({ ...common, kind: z.literal("claim-refused"), ...part, holder: z.string().min(1), reason: z.string().min(1), file: z.string().min(1).optional() }).strict().refine(onePart, ONE_PART),
  z.object({ ...common, kind: z.literal("released"), ...part }).strict().refine(onePart, ONE_PART),
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
   * (contract 4.24), with whether it is a draft, its checks, and whether it waits in the merge queue
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
   * on that machine before then died with it, and reads gone on every machine (agent link 4.29).
   */
  z.object({ ...common, kind: z.literal("machine-started"), machine: z.string().min(1), startedAt: z.string().datetime({ offset: true }) }).strict(),
  /**
   * How the app that keeps a session (`of`) names and describes it (agent link 4.19): its title, and
   * Claude's latest post-turn status, scrubbed. Written as the archive lines are, when either changes.
   */
  z.object({ ...common, kind: z.literal("session-described"), of: z.string().min(1), app: z.enum(["claude-desktop", "codex"]),
    title: z.string().min(1).optional(), status: z.string().min(1).optional() }).strict(),
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

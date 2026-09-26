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
  /** The name of the machine the line was written on (ADR-0636 D1), as the log that wrote it was told it. */
  machine: z.string().min(1).optional(),
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

/** A line as it is written: what happened, without the number and time the log gives it. */
export const NEW_LINE = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("session-started"), how: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("session-ended"), reason: z.string().min(1).optional() }).strict(),
  /** A subagent the session started: the harness's id for it, its type, and the task it was given. */
  z.object({ ...common, kind: z.literal("subagent-started"), subagent: z.string().min(1), type: z.string().min(1).optional(), task: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("file-edited"), files: z.array(z.string().min(1)).min(1) }).strict(),
  /** A shell command about to run: the harness's id for the call, which its finish line carries too. Until that line, or the end of its turn, the command is running (capability 4). */
  z.object({ ...common, kind: z.literal("command-started"), command: z.string(), call: z.string().min(1) }).strict(),
  /** A shell command that finished, whether it succeeded or failed: the call's id, where the harness gave one (lines written before ADR-0636 D2's fix carry none). */
  z.object({ ...common, kind: z.literal("command-run"), command: z.string(), call: z.string().min(1).optional() }).strict(),
  /** The agent finished its turn: no command it started in that turn is still running. */
  z.object({ ...common, kind: z.literal("turn-ended") }).strict(),
  /** A hook saw an agent ask for one of storytree's tools, before the call reached the tool server: the call's id, as the harness names it, and the agent asking. */
  z.object({ ...common, kind: z.literal("tool-requested"), tool: z.string().min(1), call: z.string().min(1), agent: AGENT }).strict(),
  z.object({ ...common, kind: z.literal("tool-called"), tool: z.string().min(1) }).strict(),
  z.object({ ...common, kind: z.literal("note-read"), ...noteRead }).strict(),
  /** A claim taken, on the git branch its session's folder was on, when it was on one (ADR-0643 D3). */
  z.object({ ...common, kind: z.literal("claimed"), capability: z.string().min(1), reason: z.string().min(1), takenOverFrom: z.string().min(1).optional(), branch: z.string().min(1).optional() }).strict(),
  z.object({ ...common, kind: z.literal("released"), capability: z.string().min(1) }).strict(),
  z.object({ ...common, kind: z.literal("landed"), capability: z.string().min(1) }).strict(),
  /**
   * A pull request from a claim's branch merged after the claim was taken, which ends it (ADR-0643
   * D3): the claim's holder, and the pull request. Written by whichever session saw it, never on
   * the holder's own session, so it makes no idle holder read as live.
   */
  z.object({ ...common, kind: z.literal("merged"), capability: z.string().min(1), holder: z.string().min(1), branch: z.string().min(1), pr: z.number().int().positive() }).strict(),
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

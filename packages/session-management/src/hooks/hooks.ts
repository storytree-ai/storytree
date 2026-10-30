/**
 * Capability 3 · Hooks (the Session management story): the commands Claude Code, Codex and Cursor, Pi through
 * the extension storytree writes for it (pi.ts), and any
 * harness that names itself and sends the published input (self-named.ts), run by themselves when a session
 * starts, after every file edit and shell command, and when it ends, each adding one line about that
 * session to the agent activity log, so an agent that never calls storytree still shows up. They always
 * exit cleanly and never print, so they can never break the agent, and when storytree isn't running
 * they do nothing. Two more name the session's agents (ADR-0629 D2): one after a subagent is started,
 * and one just before each call to storytree's own tools, which the harness waits for.
 *
 * The harness waits for a hook unless told not to. Claude Code can be told (`async`); Codex cannot,
 * so a Codex hook that must never make the agent wait (the one before each shell command, and the
 * one at the end of each turn, ADR-0636 D2) is run with `--background`: once it knows it has a line
 * to write, it hands its input to a copy of itself that it leaves running, and exits.
 *
 * The once-a-minute look around the machine (which branches still hold open work, worktrees to reap,
 * which sessions the apps keep) takes longer than a hook may run: asking GitHub alone may take 10 s.
 * So a hook hands it, when due, to a copy of itself run with `--upkeep`, which may run longer and
 * writes nothing but what that look finds. Nothing claims a capability from an edit after the fact
 * (ADR-0953 D5 retired ADR-0924's edit claims and their notices).
 *
 * One more, before each file-edit tool, which the harness waits for (`--edit-gate`, edit-gate.ts),
 * refuses an edit to a capability the session's claimed increment does not list, or that another live
 * session holds (ADR-0949 D3): it prints the refusal, which the agent reads instead of the edit happening.
 * And one after each shell command, which the harness waits for (`--shell-guard`, shell-guard.ts), prints
 * what the command changed in imported code that no yes of the user's covers (ADR-1015).
 *
 * One more, at each prompt (ADR-0636 D1, b2), prints: the project's definitions
 * for the terms the prompt names (definitions.ts), once-per-session advice to start fresh when a
 * Claude Code session passes its context guidance (context-nudge.ts), and, when the user's message carries the
 * allow command on a line of its own, that their yes to changing imported code is recorded (edit-gate.ts, ADR-1015). The harness waits for it, so it gives up
 * after 2 s and prints nothing. It also writes a line saying the session's turn began (ADR-0754 D5). And a
 * second hook at the end of each turn (`--close-out-reminder`, close-out-reminder.ts) may
 * print one request to close out, once per session, deciding from this machine alone (ADR-0758 D4).
 * No other prints: in a folder that isn't a storytree project, a session start adds nothing for the
 * agent (ADR-0752 D3).
 *
 * Nothing a hook reads grows with the log (contract 3.21): every hook of every session on every
 * machine runs one, so each reads only the lines it needs, narrowed on the server (contract 2.7),
 * never the whole log, which once made the store's egress grow with the square of its activity.
 *
 * A hook's input is the harness's own JSON on stdin. hookLines() turns it into lines, and knows
 * nothing of storytree's state; runHook() routes the session's folder (capability 1) and, only when
 * it is a project on a running storytree, opens the log and writes them. Everything a hook does is
 * inside one try: a failure anywhere means nothing is written, never an error the agent sees, and
 * a trace of why left on this machine (failures.ts, contract 3.23).
 */
import type { Harness } from "@storytree/project-and-caller/caller";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

import type { NewLine, Storytree } from "@storytree/library";

import type { ActivityLog, DeliveredEvent } from "../activity/index.js";
import { runGit, type Git } from "../activity/git.js";
import type { MergeContext, MergeWatch } from "../claims/index.js";
import type { DeclaredCapabilities } from "../claims/edit-gate.js";
import { approvedHere, findProject, openNamedProject, ProjectFolderError, requireApproval, route, storytreeHome, type LocateOptions, type Route } from "@storytree/project-and-caller";
import { claudeCodeLines } from "./claude-code.js";
import { CLOSE_OUT_REMINDER, closeOutReminder } from "./close-out-reminder.js";
import { codexLines } from "./codex.js";
import { cursorLines, cursorSession } from "./cursor.js";
import { piLines, piSession } from "./pi.js";
import { antigravityLines } from "./antigravity.js";
import { EDIT_GATE, editGate, recordYesAfterEdit, yesSaid } from "./edit-gate.js";
import { UPKEEP_DEADLINE_MS, withDeadline } from "./deadlines.js";
import { noteCodexHookRan } from "./codex-trust.js";
import { BACKGROUND } from "./at-once.js";
import { AFTER_TOOL, deliveredByTool, deliveredInput, noteDelivered, TOOL_GRACE_MS } from "./codex-delivery.js";
import { contextNudge } from "./context-nudge.js";
import { bigInjectionReport, definitionsContext, definitionsNamedIn, isHarnessNotice, notYetGiven, type InjectionReport } from "./definitions.js";
import { hookIdentity, noteHookFailure, type HookFailure } from "./failures.js";
import { isSelfNamed, selfNamedLines } from "./self-named.js";
import { shellEdits } from "./shell-edits.js";
import type { HookClock } from "./timing.js";
import { rememberedImports, SHELL_GUARD, shellGuard, watchImports, watchWorktree } from "./shell-guard.js";
import { TEST_GUARD, testGuard } from "./test-guard.js";

/** What a hook is run with: the command's arguments (the harness first, then any flags) and its stdin. */
export interface HookInput {
  readonly argv: readonly string[];
  readonly input: string;
  /**
   * With `--background`, and for the look around the machine, how the hook hands its work on: start
   * a copy of itself for `harness` with `flags`, and `input` on its stdin, that outlives this one.
   * Resolves once the input is handed over. Without it, the look is taken in this hook.
   */
  readonly handOff?: (harness: string, input: string, flags?: readonly string[]) => Promise<void>;
  /** How merges that end claims are watched for (ADR-0643 D3). By default, through `gh`. */
  readonly merges?: MergeWatch;
  /** Where storytree is. By default, where the app keeps its owner record. */
  readonly locate?: LocateOptions;
  /** Which capability each edited file declares, for the gate before each edit (`--edit-gate`). Without it the gate refuses nothing. */
  readonly declaredCapabilities?: DeclaredCapabilities;
  /** How long the hook after a shell command may wait to ask which changes a yes covers (`--shell-guard`), and the gate before an edit to judge it (`--edit-gate`). By default, each one's own. */
  readonly guardMs?: number;
  /** The hook process's clock, which its parts are timed on (timing.ts, ADR-1056 D1). Without it, nothing is timed. */
  readonly clock?: HookClock;
  /** How the hook runs git, only in an approved checkout (contract 3.46). By default, with the repository's own commands off. */
  readonly git?: Git;
}

export { BACKGROUND };
/** The flag that makes a hook take only the once-a-minute look around the machine, which may run longer than a hook. */
export const UPKEEP = "--upkeep";
/** The flag that makes a hook file only the friction report a prompt hook handed it (ADR-1049 D2), so the prompt never waits on it. */
export const BIG_INJECTION = "--big-injection";
/** The flag of the session-start hook installs before ADR-0752 registered to ask the setup question; now it does nothing. */
export const ASK_SETUP = "--ask-setup";

/** The lines one hook's input makes, and the folder the session was working in. */
export interface HookLines {
  readonly folder: string;
  readonly lines: NewLine[];
}

/** How long a hook waits to reach storytree's database before giving up and writing nothing. */
const CONNECT_TIMEOUT_MS = 2_000;

/**
 * The lines a hook input from `harness` makes, or undefined when it makes none: an event or a tool
 * the log does not record, or input that is not what that harness sends.
 */
export function hookLines(harness: string, input: unknown): HookLines | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  switch (harness) {
    case "claude-code":
      // Cursor runs Claude Code's hooks too: its own entry reports the session, so this one stands down (3.28).
      return inCursor(input) ? undefined : claudeCodeLines(input as Record<string, unknown>);
    case "codex":
      return codexLines(input as Record<string, unknown>);
    case "cursor":
      return cursorLines(input as Record<string, unknown>);
    case "pi":
      return piLines(input as Record<string, unknown>);
    case "antigravity":
      return antigravityLines(input as Record<string, unknown>);
    default:
      // Any other name is a harness naming itself, sending the input storytree publishes (ADR-1007 D4).
      return isSelfNamed(harness) ? selfNamedLines(harness, input as Record<string, unknown>) : undefined;
  }
}

/** Whether a hook input is Cursor's, which names its version on every one: also on the Claude Code hooks it loads and runs. */
export function inCursor(input: unknown): boolean {
  return typeof input === "object" && input !== null && typeof (input as Record<string, unknown>).cursor_version === "string";
}

/**
 * What a prompt hook prints to add `context` for the agent, in the shape `harness` reads; undefined for
 * nothing to add. Cursor reads `additional_context`, and `continue` lets the prompt through; Pi's extension
 * returns the answer from before_agent_start, where a message is added for the model and, with `display` off, not shown.
 */
export function promptAnswer(harness: string, context: readonly string[] | undefined, input: unknown): string | undefined {
  if (context === undefined || context.length === 0 || (harness !== "cursor" && inCursor(input))) return undefined;
  const added = context.join("\n\n");
  if (harness === "pi") return JSON.stringify({ message: { customType: "storytree", content: added, display: false } });
  return JSON.stringify(harness === "cursor" ? { continue: true, additional_context: added } : { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: added } });
}

/** A prompt the user sent, as each harness's prompt hook gives it (UserPromptSubmit; Cursor's beforeSubmitPrompt; Pi's before_agent_start). */
interface Prompted {
  readonly harness: Harness;
  readonly session: string;
  readonly folder: string;
  readonly prompt: string;
}

/**
 * Run one hook: read its input, and write its lines to the log of the project its folder belongs
 * to; while storytree cannot be reached they wait on this machine for the next hook (queue.ts). Never throws. It prints nothing but what a prompt hook adds for the
 * agent (definitions and context advice), which it returns: the command prints it.
 */
export async function runHook(hook: HookInput): Promise<string | undefined> {
  const said = await answerHook(hook);
  // Antigravity reads every hook's answer as JSON: nothing to say is an empty object.
  return said === undefined && hook.argv[0] === "antigravity" ? "{}" : said;
}

/** The flag naming the event in a hook command, for a harness whose input names none (Antigravity). */
export const EVENT = "--event=";

async function answerHook({ argv, input: given, handOff: handing, merges, locate, declaredCapabilities, guardMs, clock, git = runGit }: HookInput): Promise<string | undefined> {
  const [harness = "", ...flags] = argv;
  const read = parse(given);
  const parsed = withEvent(read, flags);
  const event = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>).hook_event_name : undefined;
  if (clock !== undefined && typeof event === "string" && event !== "") clock.event = event;
  // Every copy this hook starts is timed as its hand-off.
  const handOff: HookInput["handOff"] = handing === undefined || clock === undefined ? handing : (to, input, more) => clock.time("handoff", () => handing(to, input, more));
  // A copy this hook hands its work to is started without the flag, so the event goes with the input.
  const input = parsed === read ? given : JSON.stringify(parsed);
  const failed = (stage: HookFailure["stage"], error: unknown) => noteHookFailure(storytreeHome, hookIdentity(harness, parsed), stage, error);
  // The event as the tool server would know it too, so the log keeps it once whichever way it came (ADR-1056 D2).
  const delivered: DeliveredEvent = { key: eventKey(harness, parsed), via: "command" };
  try {
    // Any Codex hook that runs proves the user trusted storytree's hooks there (3.18), in a project or not.
    if (harness === "codex" && typeof parsed === "object" && parsed !== null) {
      noteCodexHookRan({ storytreeHome: storytreeHome(), codexHome: process.env.CODEX_HOME || path.join(homedir(), ".codex") });
    }
    // An older install's asking hook, until the next setup check replaces its registration.
    if (flags.includes(ASK_SETUP)) return;
    if (flags.includes(BIG_INJECTION)) return void (await fileBigInjection(parsed));
    // The turn-end hook that asks the agent to close out writes nothing: the other Stop hook writes the turn's line (ADR-0758 D4).
    if (flags.includes(CLOSE_OUT_REMINDER)) return closeOutReminder(harness, parsed, git);
    // The hook before each file-edit tool writes nothing: it answers whether the edit may happen (ADR-0949 D3).
    // The guard storytree's red and green builder agents run before each edit writes nothing either (3.50).
    if (flags.includes(TEST_GUARD)) return testGuard(harness, parsed, flags);
    if (flags.includes(EDIT_GATE)) return await editGate(harness, parsed, declaredCapabilities, locate, homeOf(locate), failed, guardMs);
    // The hook after each shell command that the harness waits for tells the agent of its changes to imported code (ADR-1015), and to capabilities its claims do not cover (ADR-0949 D3).
    if (flags.includes(SHELL_GUARD)) return await shellGuard(harness, parsed, hookLines(harness, parsed), locate, homeOf(locate), storytreeHome(), failed, declaredCapabilities, guardMs, git);
    const made = hookLines(harness, parsed);
    if (flags.includes(UPKEEP)) return void (made === undefined ? undefined : await upkeep(made, merges, locate));
    const asked = promptIn(harness, parsed);
    // A prompt's line is written while its context is looked up: the harness waits for both.
    if (asked !== undefined) {
      // The user's own words may carry their yes to changing imported code (contract 5.42); a harness's notice is not theirs.
      const said = isHarnessNotice(asked.prompt) ? undefined : yesSaid(harness, asked, locate, homeOf(locate), failed);
      const [looked, yes] = await Promise.all([withinTime(contextForPrompt(asked)), said, made === undefined ? undefined : writeLines(harness, input, flags, made, delivered, handOff, merges, locate, failed, declaredCapabilities !== undefined, clock, git)]);
      const context = looked?.context;
      if (looked?.report !== undefined) {
        // The report is filed by a copy of this hook, so the prompt does not wait for the library's write.
        const handed = JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: asked.session, cwd: asked.folder, report: looked.report });
        // Without a copy to hand it to, it is filed here; a failure is traced, never in the prompt's way.
        await (handOff === undefined ? fileBigInjection(JSON.parse(handed)).catch((error: unknown) => failed("hook", error)) : handOff(harness, handed, [BIG_INJECTION]));
      }
      return promptAnswer(harness, yes === undefined ? context : [...yes, ...(context ?? [])], parsed);
    }
    if (made === undefined) return;
    // After an edit the gate asked the user about, the user's yes is recorded on the increment (contract 5.41).
    await Promise.all([writeLines(harness, input, flags, made, delivered, handOff, merges, locate, failed, declaredCapabilities !== undefined, clock, git), recordYesAfterEdit(harness, parsed, locate, homeOf(locate), failed)]);
  } catch (error) {
    // A hook never breaks the agent: whatever went wrong, nothing is written and nothing is said, but why is kept here.
    failed("hook", error);
  }
  return undefined;
}

/**
 * The key of a hook event from `harness` (ADR-1056 D2): its input as both ways deliver it (for Codex, the fields its tool
 * handler sends, codex-delivery.ts), keys in order, hashed with the harness's name. It is the same whichever way the
 * event reaches storytree, so the log keeps its lines once.
 */
export function eventKey(harness: string, input: unknown): string {
  return createHash("sha256").update(JSON.stringify([harness, inOrder(deliveredInput(harness, input))])).digest("hex");
}

/** `value` with every object's keys in order, so two inputs alike but for their keys' order are one. */
function inOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inOrder);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, inOrder((value as Record<string, unknown>)[key])]));
}

/** One hook's lines as either way records them, and where. */
interface Prepared {
  readonly where: Exclude<Route, { status: "not-a-project" }>;
  readonly made: HookLines;
  readonly firstLine: NewLine | undefined;
}

/**
 * Where `made`'s lines go, and the lines as both the command hook and the tool server record them (ADR-1056 D2): each
 * naming its folder's branch, at its worktree's root, with what a shell command edited; undefined outside a project.
 * `guarded` also sets the shell guard's baseline of the worktree. The branch and the edits are read with `git` only in
 * a checkout approved for the project (contract 3.46): in any other the lines name neither.
 */
async function prepare(made: HookLines, locate: LocateOptions | undefined, failed: (stage: HookFailure["stage"], error: unknown) => void, guarded: boolean, git: Git = runGit): Promise<Prepared | undefined> {
  const where = route(made.folder, locate);
  if (where.status === "not-a-project") return undefined;
  const trusted = await mayRunGit(where, made.folder, locate);
  // The branch the folder is on now, on every line, before any waits on this machine (ADR-0754 D4).
  const { currentBranch, worktreeRoot } = await import("../activity/branch.js");
  const branch = trusted ? currentBranch(made.folder, git) : undefined;
  if (branch !== undefined) made = { ...made, lines: made.lines.map((line) => (line.branch === undefined ? { ...line, branch } : line)) };
  // A command run in a subfolder is recorded at its worktree's root, so a session lists each worktree once (4.22),
  // or, with no git repository, at the folder holding the project's marker (4.33).
  const root = worktreeRoot(made.folder);
  const marker = root === undefined ? findProject(made.folder) : undefined;
  const recordAt = root ?? (marker?.project === undefined ? undefined : marker.folder);
  if (recordAt !== undefined && recordAt !== path.resolve(made.folder)) made = { ...made, lines: made.lines.map((line) => (line.folder === made.folder ? { ...line, folder: recordAt } : line)) };
  const home = storytreeHome();
  // Observe before queueing or reaching the store: shell writes remain edits while offline, and
  // a command's edit line feeds the same upkeep/claim path as an explicit edit tool (3.22).
  const firstLine = made.lines[0];
  if (trusted && root !== undefined && firstLine !== undefined) made = { ...made, lines: [...made.lines, ...shellEdits(home, root, firstLine, (error) => failed("observe", error), git)] };
  // The shell guard's own baseline of the worktree is set here too, when it is given the map's rule to judge claims by.
  if (trusted && guarded && root !== undefined && firstLine !== undefined) watchWorktree(home, root, firstLine, failed, git);
  return { where, made, firstLine };
}

/**
 * Whether a hook may run git in `folder`, in `where`'s project (contract 3.46): only once it is known as the project's approved checkout
 * on this machine, since a folder's own git config can name programs git starts. What this machine remembers answers at
 * once; a folder it does not, while storytree runs, is asked of the library (which remembers a yes), and otherwise not.
 */
async function mayRunGit(where: Exclude<Route, { status: "not-a-project" }>, folder: string, locate: LocateOptions | undefined): Promise<boolean> {
  if (approvedHere(where.project, folder, homeOf(locate))) return true;
  if (where.status !== "routed") return false;
  try {
    const { connect } = await import("@storytree/library");
    const storytree = await connect(withDeadline(where.library, CONNECT_TIMEOUT_MS));
    try {
      return await approved(storytree, where.project, folder, homeOf(locate));
    } finally {
      await storytree.close();
    }
  } catch {
    // Unreached, nothing is known: the lines go on without git, as they would wait.
    return false;
  }
}

/** Add `lines` to `project`'s log as `delivered` records them, oldest first, counting each into `written` as it is added. */
async function appendEvent(log: ActivityLog, project: string, lines: readonly NewLine[], delivered: DeliveredEvent, written: { count: number }): Promise<void> {
  for (const line of lines) {
    await log.append(project, line, { event: delivered });
    written.count += 1;
  }
}

/** How the tool server reaches the activity log of a routed project: through its own open connection, refused (a ProjectFolderError) for a checkout not approved for it. */
export type ReachLog = (where: Extract<Route, { status: "routed" }>) => Promise<ActivityLog>;

/** What one hook event delivered through the tool server came to: how many of its lines were recorded, and how many wait on this machine. */
export interface DeliveredLines {
  readonly recorded: number;
  readonly waiting: number;
}

/**
 * Record one hook event from `harness` delivered through the tool server rather than by a command hook (ADR-1056 D2):
 * the lines the command hook makes of it, written through the server's connection (`reach`), each kept once whichever
 * way the event came. It does nothing else a command hook does: no look around the machine, no transcript shipped, no
 * claim ended. While the log cannot be reached its lines wait on this machine, as a command hook's do.
 */
export async function recordHookEvent(harness: string, input: unknown, reach: ReachLog, locate?: LocateOptions): Promise<DeliveredLines> {
  const failed = (stage: HookFailure["stage"], error: unknown) => noteHookFailure(storytreeHome, hookIdentity(harness, input), stage, error);
  const made = hookLines(harness, input);
  const ready = made === undefined || made.lines.length === 0 ? undefined : await prepare(made, locate, failed, false);
  if (ready === undefined) return { recorded: 0, waiting: 0 };
  const { where, made: lines } = ready;
  const delivered: DeliveredEvent = { key: eventKey(harness, input), via: "tool" };
  const { enqueue } = await import("./queue.js");
  const waits = (from: number): DeliveredLines => {
    enqueue(storytreeHome(), where.project, lines.lines.slice(from), delivered);
    return { recorded: from, waiting: lines.lines.length - from };
  };
  if (where.status === "not-running") return waits(0);
  let log: ActivityLog;
  try {
    log = await reach(where);
  } catch (error) {
    // A checkout not approved for the project writes nothing, not even later (ADR-0942 D1).
    if (error instanceof ProjectFolderError) return { recorded: 0, waiting: 0 };
    failed("reach", error);
    return waits(0);
  }
  const written = { count: 0 };
  try {
    await appendEvent(log, where.project, lines.lines, delivered, written);
    // Its command hook, registered beside it, stands down (codex-delivery.ts).
    noteDelivered(storytreeHome(), delivered.key);
    return { recorded: written.count, waiting: 0 };
  } catch (error) {
    failed("write", error);
    return waits(written.count);
  }
}

/** How this hook process leaves the lines it has made but not yet written waiting on this machine, while it is reaching or writing to the log. */
let leaveWaiting: (() => void) | undefined;

/**
 * At the hook's deadline, just before the command exits: the lines it has not yet written wait on this machine, for the
 * next hook to upload first (3.14), and why is traced. A hook cut off while it reached a busy store, or while its write
 * waited, lost them (seen on a loaded laptop, 2026-10-29). A line whose write landed just before is kept once by its event.
 * Never throws.
 */
export function atDeadline(): void {
  const leave = leaveWaiting;
  leaveWaiting = undefined;
  try {
    leave?.();
  } catch {
    // Nothing more can be done in the time left.
  }
}

/** Write one hook's lines to the log of the project its folder belongs to, or leave them waiting on this machine; a failure is traced with `failed`. Never throws. */
async function writeLines(harness: string, input: string, flags: readonly string[], made: HookLines, delivered: DeliveredEvent, handOff: HookInput["handOff"], merges: MergeWatch | undefined, locate: LocateOptions | undefined, failed: (stage: HookFailure["stage"], error: unknown) => void, guarded = false, clock?: HookClock, git: Git = runGit): Promise<void> {
  try {
    if (made.lines.length === 0) return;
    // Registered beside the tool server's handler (codex-delivery.ts) or under Claude Code's mod, an event the tool recorded is not recorded
    // again, nor the library reached for it; but at most once a minute a project's hook takes its whole turn, so
    // the work only a command hook does (merges, the transcript, the look around the machine) still happens.
    // Claude Code's mod waits for its delivery before a foreground hook runs, so that hook looks for the note at once (ADR-1056 D3).
    const grace = flags.includes(AFTER_TOOL) ? TOOL_GRACE_MS : harness === "claude-code" ? 0 : undefined;
    if (grace !== undefined && (await deliveredByTool(storytreeHome(), delivered.key, grace))) {
      const where = route(made.folder, locate);
      const { due } = await import("../claims/merges.js");
      if (where.status !== "routed" || !due(`${where.project}-after-tool`, UPKEEP_EVERY_MS)) {
        const { worktreeRoot } = await import("../activity/branch.js");
        const [root, first] = [worktreeRoot(made.folder), made.lines[0]];
        if (guarded && root !== undefined && first !== undefined && where.status !== "not-a-project" && approvedHere(where.project, made.folder, homeOf(locate))) watchWorktree(storytreeHome(), root, first, failed, git);
        return;
      }
    }
    const ready = await prepare(made, locate, failed, guarded, git);
    if (ready === undefined) return;
    const { where, firstLine } = ready;
    made = ready.made;
    const home = storytreeHome();
    const { enqueue, uploadQueued } = await import("./queue.js");
    if (where.status === "not-running") {
      enqueue(home, where.project, made.lines, delivered);
      return;
    }
    if (flags.includes(BACKGROUND) && handOff !== undefined) {
      await handOff(harness, input);
      return undefined;
    }
    // Only now, with lines to write and somewhere to write them, is the database reached; cut off from here, they wait.
    const written = { count: 0 };
    leaveWaiting = () => {
      failed("write", new Error(`cut off at its deadline with ${made.lines.length - written.count} of its ${made.lines.length} lines unwritten`));
      enqueue(home, where.project, made.lines.slice(written.count), delivered);
    };
    const [{ openActivityLog, thisMachine, currentBranch }, { connect }] = await Promise.all([import("../activity/index.js"), import("@storytree/library")]);
    const machine = thisMachine();
    let opened;
    const connecting = performance.now();
    try {
      const storytree = await connect(withDeadline(where.library, CONNECT_TIMEOUT_MS));
      const log = await (async () => {
        // A checkout whose trunk is not approved writes nothing, not even what waited (ADR-0942 D1).
        await requireApproval(storytree, where.project, where.folder, homeOf(locate));
        return openActivityLog(storytree, { connectTimeoutMs: CONNECT_TIMEOUT_MS, branchOf: currentBranch, ...(machine === undefined ? {} : { machine }) });
      })().catch(async (error: unknown) => {
        await storytree.close();
        throw error;
      });
      opened = { storytree, log };
    } catch (error) {
      leaveWaiting = undefined;
      if (error instanceof ProjectFolderError) return;
      failed("reach", error);
      enqueue(home, where.project, made.lines, delivered);
      return;
    } finally {
      clock?.add("connect", performance.now() - connecting);
    }
    const { storytree, log } = opened;
    const writing = performance.now();
    const handing = clock?.spent("handoff") ?? 0;
    try {
      // A folder whose marker names a deleted project's database writes nothing, under its name or into a new project of it (ADR-0831).
      if (where.identity !== undefined && (await storytree.projectIdentities())[where.project] !== where.identity) return void (leaveWaiting = undefined);
      // The folders the project imports here are remembered, and their baselines set, for the shell guard (shell-guard.ts).
      if (firstLine !== undefined) await watchImports(storytree, where.project, homeOf(locate), home, firstLine, failed, git);
      // Lines that waited go first, so the log keeps each session's lines in the order they happened; the guard's are in an imported folder.
      await uploadQueued(home, log, async (project, folder) => rememberedImports(home, project).some((place) => place.folder === folder) || approved(storytree, project, folder, homeOf(locate)));
      // The first hook to reach the log since this machine started says so, once: sessions it outlived read gone everywhere (4.29).
      const [by] = made.lines;
      if (by !== undefined) {
        const { recordMachineStart } = await import("../sessions/machine-start.js");
        await recordMachineStart(home, log, where.project, { session: by.session, ...(by.harness === undefined ? {} : { harness: by.harness }) }).catch(() => undefined);
      }
      await appendEvent(log, where.project, made.lines, delivered, written);
      leaveWaiting = undefined;
      // A claim whose pull request has merged ends now (ADR-0643 D3), except before a storytree tool
      // call or at a prompt, which the harness waits for; the tool call looks for itself.
      const [first] = made.lines;
      if (first !== undefined && first.kind !== "tool-requested" && first.kind !== "prompt-submitted") {
        // The library is opened only if a merge is seen, to apply its increment's pending plan changes (ADR-0966 D4).
        const library = () => openNamedProject(storytree, where.project, where.identity);
        const watcher = { log, project: where.project, folder: made.folder, session: first.session, ...(first.harness === undefined ? {} : { harness: first.harness }), source: "hook", library } as const;
        // The look around the machine, when due, goes to a copy that may run longer (ADR-0754 D4); never at a session's end, which the harness cuts short.
        const looks = first.kind !== "session-ended";
        if (looks && handOff !== undefined) {
          const { due } = await import("../claims/merges.js");
          if (due(`${where.project}-upkeep`, merges?.everyMs ?? UPKEEP_EVERY_MS)) await handOff(harness, input, [UPKEEP]);
        }
        const { endMergedClaims } = await import("../claims/index.js");
        await endMergedClaims(watcher, merges);
        // What the session's transcript gained since the last hook streams into the shared log, scrubbed (ADR-0749 D3, D4).
        if (first.transcript !== undefined) {
          const { shipTranscript } = await import("../transcripts/index.js");
          await shipTranscript(log, where.project, first.session, first.transcript);
        }
        if (looks && handOff === undefined) await lookAround(watcher, merges);
      }
    } catch (error) {
      // The log went away mid-hook: what it did not take waits for the next hook.
      leaveWaiting = undefined;
      failed("write", error);
      enqueue(home, where.project, made.lines.slice(written.count), delivered);
    } finally {
      // The write's time is its own: a hand-off inside it is timed as the hand-off.
      clock?.add("write", performance.now() - writing - ((clock?.spent("handoff") ?? 0) - handing));
      await log.close();
      await storytree.close();
    }
  } catch (error) {
    // Whatever went wrong, nothing is written.
    failed("write", error);
  }
}

/** How often a hook hands the look around the machine on, at most. */
const UPKEEP_EVERY_MS = 60_000;

/** The look around the machine, handed on by a hook: open the log of the project `made`'s folder belongs to, and look. Never throws. */
async function upkeep(made: HookLines, merges: MergeWatch | undefined, locate: LocateOptions | undefined): Promise<void> {
  const [first] = made.lines;
  const where = route(made.folder, locate);
  if (first === undefined || where.status !== "routed") return;
  const [{ openActivityLog, currentBranch, thisMachine }, { connect }] = await Promise.all([import("../activity/index.js"), import("@storytree/library")]);
  const machine = thisMachine();
  const storytree = await connect(withDeadline(where.library, CONNECT_TIMEOUT_MS, UPKEEP_DEADLINE_MS));
  try {
    if (!(await approved(storytree, where.project, where.folder, homeOf(locate)))) return;
    const log = await openActivityLog(storytree, { connectTimeoutMs: CONNECT_TIMEOUT_MS, branchOf: currentBranch, ...(machine === undefined ? {} : { machine }) });
    try {
      // The readings of how long this machine's hooks took go up first (ADR-1056 D1).
      const { uploadHookTimes } = await import("./timing.js");
      await uploadHookTimes(storytreeHome(), log, where.project, { session: first.session, ...(first.harness === undefined ? {} : { harness: first.harness }) });
      // The hook that handed it on found it due: each look is taken now.
      await lookAround({ log, project: where.project, folder: made.folder, session: first.session, ...(first.harness === undefined ? {} : { harness: first.harness }), source: "hook" }, { ...merges, everyMs: 0 });
    } finally {
      await log.close();
    }
  } finally {
    await storytree.close();
  }
}

/** Whether each session's branches still hold open work (ADR-0754 D4), worktrees to reap (ADR-0790) and the sessions the apps keep, each at most once a minute unless `watch` says otherwise. */
async function lookAround(watcher: MergeContext, watch: MergeWatch | undefined): Promise<void> {
  const { resolveBranches } = await import("../sessions/branch-states.js");
  await resolveBranches(watcher, watch).catch(() => []);
  // Worktrees whose sessions have left and whose work is in main are removed (ADR-0790).
  const { reapWorktrees } = await import("../sessions/worktree-reaper.js");
  await reapWorktrees(watcher, watch?.everyMs === undefined ? {} : { everyMs: watch.everyMs }).catch(() => []);
  // Which sessions the Claude desktop app and Codex keep on this machine, and whether each is archived there.
  const { recordAppStates } = await import("../sessions/app-records.js");
  await recordAppStates(watcher, watch?.everyMs === undefined ? {} : { everyMs: watch.everyMs }).catch(() => []);
}

/** The prompt in a prompt hook's input from `harness`, or undefined for any other input. */
function promptIn(harness: string, input: unknown): Prompted | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  if (harness === "cursor") {
    const { hook_event_name: event, prompt } = input as Record<string, unknown>;
    const about = cursorSession(input as Record<string, unknown>);
    return event !== "beforeSubmitPrompt" || about === undefined || typeof prompt !== "string" ? undefined : { harness, ...about, prompt };
  }
  if (harness === "pi") {
    const { hook_event_name: event, prompt } = input as Record<string, unknown>;
    const about = piSession(input as Record<string, unknown>);
    return event !== "before_agent_start" || about === undefined || typeof prompt !== "string" ? undefined : { harness, ...about, prompt };
  }
  if ((harness !== "claude-code" && harness !== "codex") || inCursor(input)) return undefined;
  const { hook_event_name: event, session_id: session, cwd: folder, prompt } = input as Record<string, unknown>;
  if (event !== "UserPromptSubmit" || typeof session !== "string" || typeof folder !== "string" || folder === "" || typeof prompt !== "string") return undefined;
  return { harness, session, folder, prompt };
}

/**
 * What the agent is to be shown for a prompt: the project's definitions for the terms it names and,
 * for Claude Code only, advice once past context guidance. Undefined for none. Both are remembered
 * separately across this session's prompts.
 */
async function contextForPrompt({ harness, session, folder, prompt }: Prompted): Promise<{ context?: string[]; report?: InjectionReport } | undefined> {
  if (isHarnessNotice(prompt)) return undefined;
  const where = route(folder);
  if (where.status !== "routed") return undefined;
  const { connect } = await import("@storytree/library");
  const storytree = await connect(withDeadline(where.library, CONNECT_TIMEOUT_MS));
  try {
    if (!(await approved(storytree, where.project, where.folder, storytreeHome()))) return undefined;
    const library = await openNamedProject(storytree, where.project, where.identity);
    const named = definitionsNamedIn(prompt, (await library.definitions()).map(({ id, fields }) => ({ id, ...fields })));
    const fresh = notYetGiven(session, named);
    const nudge = harness === "claude-code" ? await contextNudge(storytree, where.project, session) : undefined;
    const definitions = fresh.length === 0 ? undefined : definitionsContext(fresh);
    const context = [...(definitions === undefined ? [] : [definitions]), ...(nudge === undefined ? [] : [nudge])];
    const report = definitions === undefined ? undefined : bigInjectionReport(session, fresh, definitions);
    return { ...(context.length === 0 ? {} : { context }), ...(report === undefined ? {} : { report }) };
  } finally {
    await storytree.close();
  }
}

/**
 * File the friction report a prompt hook handed on (ADR-1049 D2) in the library of the project its
 * folder belongs to, as its session wrote it. A failure is thrown to the hook, which traces it.
 */
async function fileBigInjection(handed: unknown): Promise<void> {
  const { session_id: session, cwd: folder, report } = (handed ?? {}) as { session_id?: unknown; cwd?: unknown; report?: InjectionReport };
  if (typeof session !== "string" || typeof folder !== "string" || report === undefined) return;
  const where = route(folder);
  if (where.status !== "routed") return;
  const [{ recordFriction }, { currentBranch }, { connect }] = await Promise.all([import("../friction/index.js"), import("../activity/branch.js"), import("@storytree/library")]);
  const storytree = await connect(withDeadline(where.library, CONNECT_TIMEOUT_MS));
  try {
    if (!(await approved(storytree, where.project, where.folder, storytreeHome()))) return;
    const library = await openNamedProject(storytree, where.project, where.identity);
    const branch = currentBranch(folder);
    await recordFriction(library, { ...report, ...(branch === undefined ? {} : { branch }) }, { actor: `session:${session}` });
  } finally {
    await storytree.close();
  }
}

/** The storytree home routing reads for `locate`, whose machine's approved trunks a hook is held to (ADR-0942). */
function homeOf(locate: LocateOptions | undefined): string {
  return locate?.home ?? (locate?.dataDir === undefined ? storytreeHome() : path.dirname(path.resolve(locate.dataDir)));
}

/** Whether `folder` is in `project`'s approved trunk on this machine (ADR-0942); any other failure is thrown. */
async function approved(storytree: Storytree, project: string, folder: string, home: string): Promise<boolean> {
  try {
    await requireApproval(storytree, project, folder, home);
    return true;
  } catch (error) {
    if (error instanceof ProjectFolderError) return false;
    throw error;
  }
}

/** `work`'s answer, or undefined if it takes longer than reaching storytree may (the harness waits on this hook). */
function withinTime<T>(work: Promise<T | undefined>): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), CONNECT_TIMEOUT_MS)));
  return Promise.race([work.catch(() => undefined), late]).finally(() => clearTimeout(timer));
}

/** The input with the event its hook command names, where the harness's own input names none. */
function withEvent(parsed: unknown, flags: readonly string[]): unknown {
  const event = flags.find((flag) => flag.startsWith(EVENT))?.slice(EVENT.length);
  return event === undefined || typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ? parsed : { ...parsed, hook_event_name: event };
}

function parse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

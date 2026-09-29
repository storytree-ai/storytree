/**
 * Capability 3 · Hooks (the agent link story): the commands Claude Code and Codex run by
 * themselves when a session starts, after every file edit and shell command, and when it ends, each
 * adding one line about that session to the agent activity log, so an agent that never calls
 * storytree still shows up. They always exit cleanly and never print, so they can never break the
 * agent, and when storytree isn't running they do nothing. Two more name the session's agents
 * (ADR-0629 D2): one after a subagent is started, and one just before each call to storytree's own
 * tools, which the harness waits for.
 *
 * The harness waits for a hook unless told not to. Claude Code can be told (`async`); Codex cannot,
 * so a Codex hook that must never make the agent wait (the one before each shell command, and the
 * one at the end of each turn, ADR-0636 D2) is run with `--background`: once it knows it has a line
 * to write, it hands its input to a copy of itself that it leaves running, and exits.
 *
 * One more, at each prompt (ADR-0636 D1, b2), prints: the project's definitions for the terms the
 * prompt names (definitions.ts), and once-per-session advice to start fresh when a Claude Code
 * session passes its context guidance (context-nudge.ts). The harness waits for it, so it gives up
 * after 2 s and prints nothing. It also writes a line saying the session's turn began (ADR-0754 D5). And a
 * second hook at the end of each turn (`--close-out-reminder`, close-out-reminder.ts) may
 * print one request to close out, once per session, deciding from this machine alone (ADR-0758 D4).
 * No other prints: in a folder that isn't a storytree project, a session start adds nothing for the
 * agent (ADR-0752 D3).
 *
 * A hook's input is the harness's own JSON on stdin. hookLines() turns it into lines, and knows
 * nothing of storytree's state; runHook() routes the session's folder (capability 1) and, only when
 * it is a project on a running storytree, opens the log and writes them. Everything a hook does is
 * inside one try: a failure anywhere means nothing is written, never an error the agent sees.
 */
import type { NewLine } from "../activity/index.js";
import type { MergeWatch } from "../claims/index.js";
import { route, storytreeHome, withConnectTimeout, type LocateOptions } from "../routing/index.js";
import { claudeCodeLines } from "./claude-code.js";
import { CLOSE_OUT_REMINDER, closeOutReminder } from "./close-out-reminder.js";
import { codexLines } from "./codex.js";
import { contextNudge } from "./context-nudge.js";
import { definitionsContext, definitionsNamedIn, isHarnessNotice, notYetGiven } from "./definitions.js";

/** What a hook is run with: the command's arguments (the harness first, then any flags) and its stdin. */
export interface HookInput {
  readonly argv: readonly string[];
  readonly input: string;
  /**
   * With `--background`, how the hook hands its work on: start a copy of itself for `harness`,
   * with `input` on its stdin, that outlives this one. Resolves once the input is handed over.
   */
  readonly handOff?: (harness: string, input: string) => Promise<void>;
  /** How merges that end claims are watched for (ADR-0643 D3). By default, through `gh`. */
  readonly merges?: MergeWatch;
  /** Where storytree is. By default, where the app keeps its owner record. */
  readonly locate?: LocateOptions;
}

/** The flag that makes a hook hand its writing to the background instead of doing it. */
export const BACKGROUND = "--background";
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
      return claudeCodeLines(input as Record<string, unknown>);
    case "codex":
      return codexLines(input as Record<string, unknown>);
    default:
      return undefined;
  }
}

/** A prompt the user sent, as both harnesses' prompt hook gives it (UserPromptSubmit). */
interface Prompted {
  readonly harness: "claude-code" | "codex";
  readonly session: string;
  readonly folder: string;
  readonly prompt: string;
}

/**
 * Run one hook: read its input, and write its lines to the log of the project its folder belongs
 * to; while storytree cannot be reached they wait on this machine for the next hook (queue.ts). Never throws. It prints nothing but what a prompt hook adds for the
 * agent (definitions and context advice), which it returns: the command prints it.
 */
export async function runHook({ argv, input, handOff, merges, locate }: HookInput): Promise<string | undefined> {
  try {
    const [harness = "", ...flags] = argv;
    const parsed = parse(input);
    // An older install's asking hook, until the next setup check replaces its registration.
    if (flags.includes(ASK_SETUP)) return;
    // The turn-end hook that asks the agent to close out writes nothing: the other Stop hook writes the turn's line (ADR-0758 D4).
    if (flags.includes(CLOSE_OUT_REMINDER)) return closeOutReminder(harness, parsed);
    const made = hookLines(harness, parsed);
    const asked = promptIn(harness, parsed);
    // A prompt's line is written while its context is looked up: the harness waits for both.
    if (asked !== undefined) return (await Promise.all([withinTime(contextForPrompt(asked)), made === undefined ? undefined : writeLines(harness, input, flags, made, handOff, merges, locate)]))[0];
    if (made === undefined) return;
    await writeLines(harness, input, flags, made, handOff, merges, locate);
  } catch {
    // A hook never breaks the agent: whatever went wrong, nothing is written and nothing is said.
  }
  return undefined;
}

/** Write one hook's lines to the log of the project its folder belongs to, or leave them waiting on this machine. Never throws. */
async function writeLines(harness: string, input: string, flags: readonly string[], made: HookLines, handOff: HookInput["handOff"], merges: MergeWatch | undefined, locate: LocateOptions | undefined): Promise<void> {
  try {
    if (made.lines.length === 0) return;
    const where = route(made.folder, locate);
    if (where.status === "not-a-project") return;
    // The branch the folder is on now, on every line, before any waits on this machine (ADR-0754 D4).
    const { currentBranch } = await import("../activity/branch.js");
    const branch = currentBranch(made.folder);
    if (branch !== undefined) made = { ...made, lines: made.lines.map((line) => (line.branch === undefined ? { ...line, branch } : line)) };
    // Storytree cannot be reached: the lines wait on this machine for the next hook that reaches it.
    const home = storytreeHome();
    const { enqueue, uploadQueued } = await import("./queue.js");
    if (where.status === "not-running") {
      enqueue(home, where.project, made.lines);
      return;
    }
    if (flags.includes(BACKGROUND) && handOff !== undefined) {
      await handOff(harness, input);
      return undefined;
    }
    // Only now, with lines to write and somewhere to write them, is the database reached.
    const [{ openActivityLog, thisMachine }, { connect }] = await Promise.all([import("../activity/index.js"), import("@storytree/library")]);
    const machine = thisMachine();
    let opened;
    try {
      const storytree = await connect(withConnectTimeout(where.library, CONNECT_TIMEOUT_MS));
      const log = await openActivityLog(storytree, { connectTimeoutMs: CONNECT_TIMEOUT_MS, branchOf: currentBranch, ...(machine === undefined ? {} : { machine }) }).catch(async (error: unknown) => {
        await storytree.close();
        throw error;
      });
      opened = { storytree, log };
    } catch {
      enqueue(home, where.project, made.lines);
      return;
    }
    const { storytree, log } = opened;
    let written = 0;
    try {
      // Lines that waited go first, so the log keeps each session's lines in the order they happened.
      await uploadQueued(home, log);
      for (const line of made.lines) {
        await log.append(where.project, line);
        written += 1;
      }
      // A claim whose pull request has merged ends now (ADR-0643 D3), except before a storytree tool
      // call or at a prompt, which the harness waits for; the tool call looks for itself.
      const [first] = made.lines;
      if (first !== undefined && first.kind !== "tool-requested" && first.kind !== "prompt-submitted") {
        const { endMergedClaims } = await import("../claims/index.js");
        await endMergedClaims({ log, project: where.project, folder: made.folder, session: first.session, ...(first.harness === undefined ? {} : { harness: first.harness }), source: "hook" }, merges);
        // What the session's transcript gained since the last hook streams into the shared log, scrubbed (ADR-0749 D3, D4).
        if (first.transcript !== undefined) {
          const { shipTranscript } = await import("../transcripts/index.js");
          await shipTranscript(log, where.project, first.session, first.transcript);
        }
        // Whether each session's branches still hold open work (ADR-0754 D4); never at a session's end, which the harness cuts short.
        if (first.kind !== "session-ended") {
          const { resolveBranches } = await import("../sessions/branch-states.js");
          const watcher = { log, project: where.project, folder: made.folder, session: first.session, ...(first.harness === undefined ? {} : { harness: first.harness }), source: "hook" } as const;
          await resolveBranches(watcher, merges).catch(() => []);
          // Worktrees whose sessions have left and whose work is in main are removed (ADR-0790).
          const { reapWorktrees } = await import("../sessions/worktree-reaper.js");
          await reapWorktrees(watcher).catch(() => []);
          // Which sessions the Claude desktop app and Codex keep on this machine, and whether each is archived there.
          const { recordAppStates } = await import("../sessions/app-records.js");
          await recordAppStates(watcher).catch(() => []);
        }
      }
    } catch {
      // The log went away mid-hook: what it did not take waits for the next hook.
      enqueue(home, where.project, made.lines.slice(written));
    } finally {
      await log.close();
      await storytree.close();
    }
  } catch {
    // Whatever went wrong, nothing is written.
  }
}

/** The prompt in a prompt hook's input from `harness`, or undefined for any other input. */
function promptIn(harness: string, input: unknown): Prompted | undefined {
  if ((harness !== "claude-code" && harness !== "codex") || typeof input !== "object" || input === null) return undefined;
  const { hook_event_name: event, session_id: session, cwd: folder, prompt } = input as Record<string, unknown>;
  if (event !== "UserPromptSubmit" || typeof session !== "string" || typeof folder !== "string" || folder === "" || typeof prompt !== "string") return undefined;
  return { harness, session, folder, prompt };
}

/**
 * What the agent is to be shown for a prompt, as the harness's hook output: the project's
 * definitions for the terms it names and, for Claude Code only, advice once past context guidance.
 * Undefined for none. Both are remembered separately across this session's prompts.
 */
async function contextForPrompt({ harness, session, folder, prompt }: Prompted): Promise<string | undefined> {
  if (isHarnessNotice(prompt)) return undefined;
  const where = route(folder);
  if (where.status !== "routed") return undefined;
  const { connect } = await import("@storytree/library");
  const storytree = await connect(where.library);
  try {
    const library = await storytree.openProject(where.project);
    const named = definitionsNamedIn(prompt, (await library.definitions()).map(({ id, fields }) => ({ id, ...fields })));
    const fresh = notYetGiven(session, named);
    const nudge = harness === "claude-code" ? await contextNudge(storytree, where.project, session) : undefined;
    const context = [...(fresh.length === 0 ? [] : [definitionsContext(fresh)]), ...(nudge === undefined ? [] : [nudge])];
    if (context.length === 0) return undefined;
    return JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context.join("\n\n") } });
  } finally {
    await storytree.close();
  }
}

/** `work`'s answer, or undefined if it takes longer than reaching storytree may (the harness waits on this hook). */
function withinTime<T>(work: Promise<T | undefined>): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), CONNECT_TIMEOUT_MS)));
  return Promise.race([work.catch(() => undefined), late]).finally(() => clearTimeout(timer));
}

function parse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return undefined;
  }
}

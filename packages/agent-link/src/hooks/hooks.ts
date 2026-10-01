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
 * The once-a-minute look around the machine (which branches still hold open work, worktrees to reap,
 * which sessions the apps keep) takes longer than a hook may run: asking GitHub alone may take 10 s.
 * So a hook hands it, when due, to a copy of itself run with `--upkeep`, which may run longer and
 * writes nothing but what that look finds.
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
import { homedir } from "node:os";
import path from "node:path";

import type { NewLine } from "../activity/index.js";
import type { MergeContext, MergeWatch } from "../claims/index.js";
import { openNamedProject, route, storytreeHome, withConnectTimeout, type LocateOptions } from "../routing/index.js";
import { claudeCodeLines } from "./claude-code.js";
import { CLOSE_OUT_REMINDER, closeOutReminder } from "./close-out-reminder.js";
import { codexLines } from "./codex.js";
import { noteCodexHookRan } from "./codex-trust.js";
import { contextNudge } from "./context-nudge.js";
import { definitionsContext, definitionsNamedIn, isHarnessNotice, notYetGiven } from "./definitions.js";

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
}

/** The flag that makes a hook hand its writing to the background instead of doing it. */
export const BACKGROUND = "--background";
/** The flag that makes a hook take only the once-a-minute look around the machine, which may run longer than a hook. */
export const UPKEEP = "--upkeep";
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
    // Any Codex hook that runs proves the user trusted storytree's hooks there (3.18), in a project or not.
    if (harness === "codex" && typeof parsed === "object" && parsed !== null) {
      noteCodexHookRan({ storytreeHome: storytreeHome(), codexHome: process.env.CODEX_HOME || path.join(homedir(), ".codex") });
    }
    // An older install's asking hook, until the next setup check replaces its registration.
    if (flags.includes(ASK_SETUP)) return;
    // The turn-end hook that asks the agent to close out writes nothing: the other Stop hook writes the turn's line (ADR-0758 D4).
    if (flags.includes(CLOSE_OUT_REMINDER)) return closeOutReminder(harness, parsed);
    const made = hookLines(harness, parsed);
    if (flags.includes(UPKEEP)) return void (made === undefined ? undefined : await upkeep(made, merges, locate));
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
      // A folder whose marker names a deleted project's database writes nothing, under its name or into a new project of it (ADR-0831).
      if (where.identity !== undefined && (await storytree.projectIdentities())[where.project] !== where.identity) return;
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
        const watcher = { log, project: where.project, folder: made.folder, session: first.session, ...(first.harness === undefined ? {} : { harness: first.harness }), source: "hook" } as const;
        // The look around the machine, when due, goes to a copy that may run longer (ADR-0754 D4); never at a session's end, which the harness cuts short.
        const looks = first.kind !== "session-ended";
        if (looks && handOff !== undefined) {
          const { due } = await import("../claims/merges.js");
          if (due(`${where.project}-upkeep`, merges?.everyMs ?? UPKEEP_EVERY_MS)) await handOff(harness, input, [UPKEEP]);
        }
        const { endMergedClaims } = await import("../claims/index.js");
        await endMergedClaims({ log, project: where.project, folder: made.folder, session: first.session, ...(first.harness === undefined ? {} : { harness: first.harness }), source: "hook" }, merges);
        // What the session's transcript gained since the last hook streams into the shared log, scrubbed (ADR-0749 D3, D4).
        if (first.transcript !== undefined) {
          const { shipTranscript } = await import("../transcripts/index.js");
          await shipTranscript(log, where.project, first.session, first.transcript);
        }
        if (looks && handOff === undefined) await lookAround(watcher, merges);
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

/** How often a hook hands the look around the machine on, at most. */
const UPKEEP_EVERY_MS = 60_000;

/** The look around the machine, handed on by a hook: open the log of the project `made`'s folder belongs to, and look. Never throws. */
async function upkeep(made: HookLines, merges: MergeWatch | undefined, locate: LocateOptions | undefined): Promise<void> {
  const [first] = made.lines;
  const where = route(made.folder, locate);
  if (first === undefined || where.status !== "routed") return;
  const [{ openActivityLog, currentBranch, thisMachine }, { connect }] = await Promise.all([import("../activity/index.js"), import("@storytree/library")]);
  const machine = thisMachine();
  const storytree = await connect(withConnectTimeout(where.library, CONNECT_TIMEOUT_MS));
  try {
    const log = await openActivityLog(storytree, { connectTimeoutMs: CONNECT_TIMEOUT_MS, branchOf: currentBranch, ...(machine === undefined ? {} : { machine }) });
    try {
      // The hook that handed it on found it due: each look is taken now.
      await lookAround({ log, project: where.project, folder: made.folder, session: first.session, ...(first.harness === undefined ? {} : { harness: first.harness }), source: "hook" }, { ...merges, everyMs: 0 });
    } finally {
      await log.close();
    }
  } finally {
    await storytree.close();
  }
}

/** Whether each session's branches still hold open work (ADR-0754 D4), worktrees to reap (ADR-0790), and the sessions the apps keep, each at most once a minute unless `watch` says otherwise. */
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
    const library = await openNamedProject(storytree, where.project, where.identity);
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

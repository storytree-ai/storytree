/**
 * Capability 3 · Hooks (stories/agent-link.md): the commands Claude Code and Codex run by
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
 * One more, at each prompt (ADR-0636 D1, b2), is the one hook that prints: the project's
 * definitions for the terms the prompt names (definitions.ts), which the harness adds for the agent.
 * The harness waits for it, so it gives up after 2 s and prints nothing.
 *
 * A hook's input is the harness's own JSON on stdin. hookLines() turns it into lines, and knows
 * nothing of storytree's state; runHook() routes the session's folder (capability 1) and, only when
 * it is a project on a running storytree, opens the log and writes them. Everything a hook does is
 * inside one try: a failure anywhere means nothing is written, never an error the agent sees.
 */
import type { NewLine } from "../activity/index.js";
import type { MergeWatch } from "../claims/index.js";
import { route, type LocateOptions } from "../routing/index.js";
import { claudeCodeLines } from "./claude-code.js";
import { codexLines } from "./codex.js";
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
  readonly session: string;
  readonly folder: string;
  readonly prompt: string;
}

/**
 * Run one hook: read its input, and write its lines to the log of the project its folder belongs
 * to, if storytree is running. Never throws. It prints nothing but what a prompt hook adds for the
 * agent (the project's definitions for the prompt's terms), which it returns: the command prints it.
 */
export async function runHook({ argv, input, handOff, merges, locate }: HookInput): Promise<string | undefined> {
  try {
    const [harness = "", ...flags] = argv;
    const parsed = parse(input);
    const asked = promptIn(harness, parsed);
    if (asked !== undefined) return await withinTime(definitionsFor(asked));
    const made = hookLines(harness, parsed);
    if (made === undefined || made.lines.length === 0) return;
    const where = route(made.folder, locate);
    if (where.status !== "routed") return;
    if (flags.includes(BACKGROUND) && handOff !== undefined) {
      await handOff(harness, input);
      return undefined;
    }
    // Only now, with lines to write and somewhere to write them, is the database reached.
    const { openActivityLog, thisMachine } = await import("../activity/index.js");
    const machine = thisMachine();
    const log = await openActivityLog(where.url, { connectTimeoutMs: CONNECT_TIMEOUT_MS, ...(machine === undefined ? {} : { machine }) });
    try {
      for (const line of made.lines) await log.append(where.project, line);
      // A claim whose pull request has merged ends now (ADR-0643 D3), except before a storytree tool
      // call, which the harness waits for and which looks for itself.
      const [first] = made.lines;
      if (first !== undefined && first.kind !== "tool-requested") {
        const { endMergedClaims } = await import("../claims/index.js");
        await endMergedClaims({ log, project: where.project, folder: made.folder, session: first.session, ...(first.harness === undefined ? {} : { harness: first.harness }), source: "hook" }, merges);
      }
    } finally {
      await log.close();
    }
  } catch {
    // A hook never breaks the agent: whatever went wrong, nothing is written and nothing is said.
  }
  return undefined;
}

/** The prompt in a prompt hook's input from `harness`, or undefined for any other input. */
function promptIn(harness: string, input: unknown): Prompted | undefined {
  if ((harness !== "claude-code" && harness !== "codex") || typeof input !== "object" || input === null) return undefined;
  const { hook_event_name: event, session_id: session, cwd: folder, prompt } = input as Record<string, unknown>;
  if (event !== "UserPromptSubmit" || typeof session !== "string" || typeof folder !== "string" || folder === "" || typeof prompt !== "string") return undefined;
  return { session, folder, prompt };
}

/**
 * What the agent is to be shown for a prompt, as the harness's hook output: the project's
 * definitions for the terms it names, those not yet given to this session. Undefined for none.
 */
async function definitionsFor({ session, folder, prompt }: Prompted): Promise<string | undefined> {
  if (isHarnessNotice(prompt)) return undefined;
  const where = route(folder);
  if (where.status !== "routed") return undefined;
  const { connect } = await import("@storytree/library");
  const storytree = await connect({ url: where.url });
  try {
    const library = await storytree.openProject(where.project);
    const named = definitionsNamedIn(prompt, (await library.definitions()).map(({ id, fields }) => ({ id, ...fields })));
    const fresh = notYetGiven(session, named);
    if (fresh.length === 0) return undefined;
    return JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: definitionsContext(fresh) } });
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

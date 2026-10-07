/**
 * Capability 9 · Context readings. `storytree context` (contract 9.6): this session's context reading, from a shell. The command
 * line's front door hands its arguments here. The session is the one the harness put in the
 * shell's environment: Claude Code's `CLAUDE_CODE_SESSION_ID`, Codex's `CODEX_THREAD_ID`. It exits
 * 0 whatever it finds: a figure, or an absence said in words and never as a number.
 */
import path from "node:path";

import { route, type LocateOptions } from "../routing/index.js";
import { readContext, type ContextReading } from "./context.js";
import { guidanceSentence } from "./guidance.js";

export interface ContextCommandOptions {
  /** The folder the command runs in: its project is routed from here. */
  readonly folder: string;
  /** The shell's environment, where the harness names the session. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Print the reading record as JSON instead of a sentence. */
  readonly json?: boolean;
  readonly locate?: LocateOptions;
}

/** What the command prints, and its exit code. */
export interface ContextCommandAnswer {
  readonly text: string;
  readonly code: number;
}

export async function contextCommand({ folder, env, json = false, locate }: ContextCommandOptions): Promise<ContextCommandAnswer> {
  const session = env.CLAUDE_CODE_SESSION_ID?.trim() || env.CODEX_THREAD_ID?.trim();
  if (!session) return said(json, "This shell names no agent session (neither CLAUDE_CODE_SESSION_ID nor CODEX_THREAD_ID is set), so there is no context reading.");
  const where = route(folder, locate);
  if (where.status !== "routed") return said(json, `No context reading: ${where.message}.`);
  const [{ openActivityLog }, { connect }] = await Promise.all([import("../activity/index.js"), import("@storytree/library")]);
  const storytree = await connect(where.library);
  try {
    const log = await openActivityLog(storytree);
    const home = locate?.home ?? (locate?.dataDir === undefined ? undefined : path.dirname(path.resolve(locate.dataDir)));
    const reading = await readContext(log, where.project, session, home === undefined ? {} : { home });
    await log.close();
    return { text: json ? JSON.stringify(reading) : sentence(reading), code: 0 };
  } finally {
    await storytree.close();
  }
}

/** The reading as one sentence: the figure and where it came from, or the absence in words. */
function sentence(reading: ContextReading): string {
  if ("absent" in reading) return `No context reading for this session: ${reading.absent}.`;
  return `This session's context holds ${reading.tokens.toLocaleString("en-US")} tokens (read from ${reading.source}). ${guidanceSentence(reading.guidance)}`;
}

function said(json: boolean, text: string): ContextCommandAnswer {
  return { text: json ? JSON.stringify({ absent: text }) : text, code: 0 };
}

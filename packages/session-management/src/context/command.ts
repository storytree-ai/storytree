// Capability 9 · Context readings
import path from "node:path";

import { ProjectFolderError, requireApproval, route, storytreeHome, type LocateOptions } from "@storytree/project-and-caller";
import { SESSION_ENV, WATCHED_HARNESSES, type WatchedHarness } from "@storytree/project-and-caller/caller";
import { readContext, type ContextReading } from "./context.js";
import { guidanceSentence } from "./guidance.js";

export interface ContextCommandOptions {
  readonly folder: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly json?: boolean;
  readonly locate?: LocateOptions;
}

export interface ContextCommandAnswer {
  readonly text: string;
  readonly code: number;
}

const SESSION_VARIABLES = [...WATCHED_HARNESSES.flatMap((harness: WatchedHarness) => harness.shellSession ?? []), SESSION_ENV];

function shellSession(env: ContextCommandOptions["env"]): string | undefined {
  return SESSION_VARIABLES.map((name) => env[name]?.trim()).find((value) => value !== undefined && value !== "");
}

export async function contextCommand({ folder, env, json = false, locate }: ContextCommandOptions): Promise<ContextCommandAnswer> {
  const session = shellSession(env);
  if (!session) return said(json, `This shell names no agent session (none of ${SESSION_VARIABLES.join(", ")} is set), so there is no context reading. In a harness storytree has no hooks for, set ${SESSION_ENV} to the session id check_setup names.`);
  const where = route(folder, locate);
  if (where.status !== "routed") return said(json, `No context reading: ${where.message}.`);
  const [{ openActivityLog }, { connect }] = await Promise.all([import("../activity/index.js"), import("@storytree/library")]);
  const storytree = await connect(where.library);
  try {
    const home = locate?.home ?? (locate?.dataDir === undefined ? undefined : path.dirname(path.resolve(locate.dataDir)));
    try {
      await requireApproval(storytree, where.project, where.folder, home ?? storytreeHome());
    } catch (error) {
      if (error instanceof ProjectFolderError) return said(json, `No context reading: ${error.message}`);
      throw error;
    }
    const log = await openActivityLog(storytree);
    const reading = await readContext(log, where.project, session, home === undefined ? {} : { home });
    await log.close();
    return { text: json ? JSON.stringify(reading) : sentence(reading), code: 0 };
  } finally {
    await storytree.close();
  }
}

function sentence(reading: ContextReading): string {
  if ("absent" in reading) return `No context reading for this session: ${reading.absent}.`;
  return `This session's context holds ${reading.tokens.toLocaleString("en-US")} tokens (read from ${reading.source}). ${guidanceSentence(reading.guidance)}`;
}

function said(json: boolean, text: string): ContextCommandAnswer {
  return { text: json ? JSON.stringify({ absent: text }) : text, code: 0 };
}

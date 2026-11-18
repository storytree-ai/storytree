// Capability 6 · Tool server (the MCP server)
import { execFile } from "node:child_process";

import { mounted, type Verb, type VerbInputs } from "@storytree/library/verbs";
import { SESSION_ENV, WATCHED_HARNESSES, type WatchedHarness } from "@storytree/project-and-caller/caller";

import type { ToolContext } from "./mount.js";

export type DrainStep = (caller: { readonly session: string; readonly harness?: string }, folder: string, project: string) => Promise<string[]>;

const DRAIN_TOOL = "friction_drain";

const STEP_LIMIT_MS = 120_000;

export function drainedBy(verbs: readonly Verb<VerbInputs, ToolContext>[], step: DrainStep): Verb<VerbInputs, ToolContext>[] {
  return verbs.map((verb) => !mounted(verb.tool) || verb.tool.name !== DRAIN_TOOL ? verb : {
    ...verb,
    async act(input, context, words) {
      const answer = await verb.act(input, context, words);
      const caller = context.harness === undefined ? { session: context.session } : { session: context.session, harness: context.harness };
      const said = await step(caller, context.folder, context.library.name).catch((error: unknown) => [`The doors learner did not run: ${error instanceof Error ? error.message : String(error)}`]);
      return { ...answer, text: [answer.text, ...said].join("\n") };
    },
  });
}

export function commandStep(command: readonly string[], env: Readonly<Record<string, string | undefined>>): DrainStep {
  const unnamed = { ...env };
  for (const name of [...(WATCHED_HARNESSES as readonly WatchedHarness[]).flatMap((harness) => harness.shellSession ?? []), SESSION_ENV]) delete unnamed[name];
  return (caller, folder, project) => new Promise((resolve, reject) => {
    const [program, ...before] = command;
    const args = [...before, "doors", "learn", "--session", caller.session, ...(caller.harness === undefined ? [] : ["--harness", caller.harness]), "--project", project];
    execFile(program!, args, { cwd: folder, env: unnamed, timeout: STEP_LIMIT_MS, windowsHide: true }, (error, stdout, stderr) => {
      const said = stdout.trimEnd();
      if (error !== null) reject(new Error(stderr.trim() || said || error.message));
      else resolve(said === "" ? [] : said.split(/\r?\n/));
    });
  });
}

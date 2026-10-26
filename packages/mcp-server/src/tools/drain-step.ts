/**
 * Capability 6 · Agent tools (the MCP server). The drain step: what friction_drain runs after the drain, as the command
 * line's `storytree friction drain` runs the doors learner after its own (ADR-1045 D7, on both doors as ADR-0793 has them).
 * The learner judges every command, and this server cannot import the command line that lists them, so whoever mounts
 * the server injects the step: the bin runs `storytree doors learn` for the calling session. A step that fails says so
 * under the drain's answer and never stops it.
 */
import { execFile } from "node:child_process";

import { mounted, type Verb, type VerbInputs } from "@storytree/library/verbs";
import { SESSION_ENV, WATCHED_HARNESSES, type WatchedHarness } from "@storytree/project-and-caller/caller";

import type { ToolContext } from "./mount.js";

/** The lines a drain step adds under friction_drain's answer, run for the calling session in the folder it works in. */
export type DrainStep = (caller: { readonly session: string; readonly harness?: string }, folder: string) => Promise<string[]>;

/** The tool the step follows. */
const DRAIN_TOOL = "friction_drain";

/** How long the command line's learner may take before the step gives up on it. */
const STEP_LIMIT_MS = 120_000;

/** `verbs` with friction_drain's followed by `step`; every other verb as it is. */
export function drainedBy(verbs: readonly Verb<VerbInputs, ToolContext>[], step: DrainStep): Verb<VerbInputs, ToolContext>[] {
  return verbs.map((verb) => !mounted(verb.tool) || verb.tool.name !== DRAIN_TOOL ? verb : {
    ...verb,
    async act(input, context, words) {
      const answer = await verb.act(input, context, words);
      const caller = context.harness === undefined ? { session: context.session } : { session: context.session, harness: context.harness };
      const said = await step(caller, context.folder).catch((error: unknown) => [`The doors learner did not run: ${error instanceof Error ? error.message : String(error)}`]);
      return { ...answer, text: [answer.text, ...said].join("\n") };
    },
  });
}

/**
 * The step that runs `command doors learn` for the caller in its folder. The command runs with no harness session in its
 * environment, the caller passed as flags instead, so it records no command-line call of its own: otherwise every tool
 * drain would count as a call through the other door, on the very reading the learner makes.
 */
export function commandStep(command: readonly string[], env: Readonly<Record<string, string | undefined>>): DrainStep {
  const unnamed = { ...env };
  for (const name of [...(WATCHED_HARNESSES as readonly WatchedHarness[]).flatMap((harness) => harness.shellSession ?? []), SESSION_ENV]) delete unnamed[name];
  return (caller, folder) => new Promise((resolve, reject) => {
    const [program, ...before] = command;
    const args = [...before, "doors", "learn", "--session", caller.session, ...(caller.harness === undefined ? [] : ["--harness", caller.harness])];
    execFile(program!, args, { cwd: folder, env: unnamed, timeout: STEP_LIMIT_MS, windowsHide: true }, (error, stdout, stderr) => {
      const said = stdout.trimEnd();
      if (error !== null) reject(new Error(stderr.trim() || said || error.message));
      else resolve(said === "" ? [] : said.split(/\r?\n/));
    });
  });
}

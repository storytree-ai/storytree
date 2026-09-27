/**
 * Capability 8 · Doctor (the command line story): run storytree's setup check from a terminal, the same one
 * every agent session start runs: is storytree running, are the hooks registered and last seen
 * firing, is this folder a project, is `storytree` on the path, is `gh` signed in, is Claude Code or
 * Codex signed in, and are git and a usable Node there (ADR-0716). It fixes what the
 * check fixes by itself and names the fix for the rest, and it sets a folder up as a project only
 * when you tell it to.
 *
 * - The check is the agent link's `runSetupCheck` (its capability 8), which opens storytree when it
 *   is closed, registers the hooks, and puts the `storytree` command on the path. Those last two
 *   need storytree's hook script, which an installed storytree keeps beside this command; run from
 *   anywhere else, the doctor says so rather than registering something else.
 * - Setting a folder up is the agent link's `setUpProject`, called only for `--set-up <name>`.
 * - The hooks last seen firing is the latest hook line in the project's activity log.
 * - `storytree setup install | remove` stays the agent link's own command, run from beside this one.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { openActivityLog, runSetupCheck, setUpProject, type SetupReport } from "@storytree/agent-link";

import { Refusal, type Answer } from "../answer.js";
import type { Family, Verb } from "../door.js";

const HARNESSES = { "claude-code": "Claude Code", codex: "Codex" } as const;

/** storytree's hook script, when this command sits beside it as an installed storytree's does. */
function hookBeside(script: string | undefined): string | undefined {
  if (script === undefined) return undefined;
  const hook = path.join(path.dirname(script), "storytree-hook.mjs");
  return existsSync(hook) ? hook : undefined;
}

function hooksSaid(report: SetupReport): string[] {
  if (report.hooks === undefined) {
    return ["Hooks: not checked. This storytree command is not beside storytree's hooks, so it cannot register them: run the storytree your agent's setup put on your path."];
  }
  const said = (Object.keys(HARNESSES) as (keyof typeof HARNESSES)[]).map((harness) => {
    const state = report.hooks![harness];
    return `Hooks for ${HARNESSES[harness]}: ${state === "registered" ? "registered now" : state === "already registered" ? "registered" : "not installed on this machine"}.`;
  });
  const statusLine = report.hooks.statusLine;
  if (statusLine === "installed") said.push("Claude Code status line: storytree's installed now; it shows from the next session.");
  if (statusLine === "the user's own kept") said.push("Claude Code status line: yours is kept; storytree never replaces it.");
  return said;
}

function commandSaid(report: SetupReport): string[] {
  switch (report.command) {
    case "installed":
      return ["The storytree command: put on your path now."];
    case "already installed":
      return ["The storytree command: on your path."];
    case "another storytree kept":
      return ["The storytree command: there is a storytree of your own on your path, so storytree's was not put there."];
    case "no folder of the user's on the path":
      return ["The storytree command: no folder of yours is on your PATH to put it in. Add one (such as ~/.local/bin) and run `storytree doctor` again."];
    default:
      return [];
  }
}

function ghSaid(report: SetupReport): string[] {
  switch (report.gh) {
    case "signed out":
      return ["GitHub's gh is not signed in, so a claim will not end when its pull request merges. Fix: run `gh auth login`."];
    case "missing":
      return ["GitHub's gh is not installed, so a claim will not end when its pull request merges. Fix: install it from https://cli.github.com, then run `gh auth login`."];
    default:
      return ["GitHub's gh: signed in."];
  }
}

/** The agent CLI, git and Node lines, as the setup check words them. */
function machineSaid(report: SetupReport): string[] {
  return report.lines
    .filter((line) => line.check === "agent-cli" || line.check === "git" || line.check === "node")
    .map((line) => (line.fix === undefined ? line.message : `${line.message} Fix: ${line.fix}`));
}

/** When storytree last heard from a hook in `project`, and from which harness. */
async function lastHook(url: string, project: string): Promise<string> {
  const log = await openActivityLog(url);
  try {
    const hook = (await log.since(project, 0)).lines.filter((line) => line.source === "hook").at(-1);
    if (hook === undefined) return "No hook has reached storytree in this project yet: start an agent session here.";
    return `Hooks last seen firing: ${hook.at}${hook.harness === undefined ? "" : `, from ${HARNESSES[hook.harness as keyof typeof HARNESSES] ?? hook.harness}`}.`;
  } finally {
    await log.close();
  }
}

const doctor: Verb = {
  name: "doctor",
  usage: "doctor [--set-up <project>]",
  summary: "check storytree's setup, fix what it can, and name the fix for the rest",
  async act(args, context): Promise<Answer> {
    const hook = hookBeside(context.script);
    const report = await runSetupCheck({
      folder: context.cwd,
      ...(hook === undefined ? {} : { hook: { node: process.execPath, script: hook }, command: { path: process.env.PATH ?? process.env.Path ?? "", home: homedir() } }),
    });
    if (report.storytree.state === "not running") throw new Refusal(report.storytree.message);
    const said = [report.storytree.state === "opened" ? "storytree was closed, so it has been opened." : "storytree is running."];
    said.push(...hooksSaid(report));
    const next = [];
    const setUp = args.text("set-up");
    if (report.project.status === "set up") {
      said.push(`This folder is storytree project "${report.project.name}".`);
      said.push(await lastHook(report.storytree.url, report.project.name));
    } else if (setUp !== undefined) {
      const { connect } = await import("@storytree/library");
      const storytree = await connect({ url: report.storytree.url });
      try {
        await setUpProject({ folder: context.cwd, project: setUp, storytree });
      } finally {
        await storytree.close();
      }
      said.push(`This folder is set up as storytree project "${setUp}" now.`);
    } else {
      said.push(`This folder is not a storytree project. Nothing was set up: storytree sets a folder up only when you tell it to.`);
      next.push({ command: `storytree doctor --set-up ${report.project.suggestion}`, why: "make it a project, or name it as you like" });
    }
    said.push(...commandSaid(report), ...ghSaid(report), ...machineSaid(report));
    return { text: said.join("\n"), next };
  },
};

const setup: Verb = {
  name: "setup",
  usage: "setup install | remove",
  summary: "register storytree's hooks now, or take out exactly what storytree added",
  async act(args, context) {
    const script = context.script === undefined ? undefined : path.join(path.dirname(context.script), "storytree-setup.mjs");
    if (script === undefined || !existsSync(script)) {
      throw new Refusal("storytree setup is the agent link's, and runs from an installed storytree: this command is not beside it");
    }
    const ran = spawnSync(process.execPath, [script, ...args.words], { encoding: "utf8" });
    if (ran.status !== 0) throw new Refusal(`${ran.stderr}${ran.stdout}`.trim() || "storytree setup failed", { code: ran.status ?? 1 });
    return { text: ran.stdout };
  },
};

export const doctorFamily: Family = {
  name: "doctor",
  summary: "storytree's setup check, from a terminal",
  verbs: [],
  bare: doctor,
};

export const setupFamily: Family = {
  name: "setup",
  summary: "install or remove storytree's hooks (the agent link's)",
  verbs: [],
  bare: setup,
};

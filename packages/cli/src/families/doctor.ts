/**
 * Capability 8 · Doctor (the command line story): run storytree's setup check from a terminal, the same one
 * every agent session start runs: is storytree running, are the hooks registered and last seen
 * firing, does Codex have storytree's tool server, is this folder a project, is `storytree` on the path, is `gh` signed in, is Claude Code or
 * Codex signed in, and are git and a usable Node there (ADR-0716). It fixes what the
 * check fixes by itself and names the fix for the rest, and it sets a folder up as a project only
 * when you tell it to.
 *
 * - The check is the agent link's `runSetupCheck` (its capability 8), which opens storytree when it
 *   is closed, registers the hooks, and puts the `storytree` command on the path. Those last two
 *   need storytree's hook script, which an installed storytree keeps beside this command; run from
 *   anywhere else, the doctor says so rather than registering something else.
 * - Setting a folder up is the agent link's `setUpProject`, called only for `--set-up <name>`, or
 *   `--join <name>` to add this machine's checkout to a project that already exists (ADR-0757 D4).
 * - A folder whose marker names a project is read only once it is approved as that project's
 *   checkout on this machine (ADR-0942 D1); until then the doctor says so, and `--join <name>` run
 *   there approves it on purpose.
 * - The hooks last seen firing is the latest hook line in the project's activity log.
 * - `storytree setup install | remove` stays the agent link's own command, run from beside this one.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { SetupReport } from "@storytree/app-setup/setup";
import { findProject, ProjectFolderError, requireApproval } from "@storytree/agent-link/routing";
import { setUpProject, suggestProjectName } from "@storytree/app-setup/project";
import type { ConnectOptions } from "@storytree/library";

import { Refusal, type Answer } from "../answer.js";
import type { Family, Verb } from "../door.js";
import { setupConnectionVerbs } from "./setup.js";

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
    const replaced = report.hooks!.replaced?.[harness] ?? [];
    return `Hooks for ${HARNESSES[harness]}: ${state === "registered" ? `registered now${replaced.length > 0 ? `, replacing another build's hooks, which ran ${replaced.join(" and ")}` : ""}` : state === "already registered" ? "registered" : state === "disconnected" ? "none, since you disconnected it (`storytree setup connect` connects it again)" : "not installed on this machine"}.`;
  });
  const server = report.lines.find((line) => line.check === "codex-server" && line.fix !== undefined);
  if (server !== undefined) said.push(`${server.message} Fix: ${server.fix}`);
  // Whether Codex runs its hooks yet, and an administrator terminal where it cannot (agent link 8.16, 8.17).
  for (const line of report.lines.filter((each) => each.check === "codex-hooks" || each.check === "elevated")) said.push(line.fix === undefined ? line.message : `${line.message} Fix: ${line.fix}`);
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
  const line = report.lines.find((each) => each.check === "gh");
  return report.gh === "signed in" || line === undefined ? ["GitHub's gh: signed in."] : [line.message];
}

/** The agent CLI, git and Node lines, as the setup check words them. */
function machineSaid(report: SetupReport): string[] {
  return report.lines
    .filter((line) => line.check === "agent-cli" || line.check === "git" || line.check === "node")
    .map((line) => (line.fix === undefined ? line.message : `${line.message} Fix: ${line.fix}`));
}

/** When storytree last heard from a hook in `project`, and from which harness. */
async function lastHook(library: ConnectOptions, project: string): Promise<string> {
  const { connect } = await import("@storytree/library");
  const storytree = await connect(library);
  const { openActivityLog } = await import("@storytree/agent-link");
  const log = await openActivityLog(storytree).catch(async (error: unknown) => {
    await storytree.close();
    throw error;
  });
  try {
    const [hook] = await log.lines(project, { where: { source: "hook" }, newest: 1, omit: ["command", "files", "transcript"] });
    if (hook === undefined) return "No hook has reached storytree in this project yet: start an agent session here.";
    return `Hooks last seen firing: ${hook.at}${hook.harness === undefined ? "" : `, from ${HARNESSES[hook.harness as keyof typeof HARNESSES] ?? hook.harness}`}.`;
  } finally {
    await log.close();
    await storytree.close();
  }
}

/** Join `project` from `folder`, the folder its marker already names: how a recorded checkout is approved (ADR-0942 D1). */
async function joinHere(folder: string, project: string, library: ConnectOptions): Promise<void> {
  const { connect } = await import("@storytree/library");
  const storytree = await connect(library);
  try {
    // Joining approves the checkout from its own top folder, where the marker is.
    const at = findProject(folder);
    await setUpProject({ folder: at.project === undefined ? folder : at.folder, project, storytree, join: true }).catch((error: unknown) => {
      throw error instanceof ProjectFolderError ? new Refusal(error.message) : error;
    });
  } finally {
    await storytree.close();
  }
}

/** Whether `folder` is approved as `project`'s checkout on this machine. */
async function approvedHere(folder: string, project: string, library: ConnectOptions): Promise<boolean> {
  const { connect } = await import("@storytree/library");
  const storytree = await connect(library);
  try {
    return await requireApproval(storytree, project, folder).then(() => true, (error: unknown) => {
      if (error instanceof ProjectFolderError) return false;
      throw error;
    });
  } finally {
    await storytree.close();
  }
}

const doctor: Verb = {
  name: "doctor",
  usage: "doctor [--set-up <project> | --join <project>]",
  summary: "check storytree's setup, fix what it can, and name the fix for the rest",
  async act(args, context): Promise<Answer> {
    const hook = hookBeside(context.script);
    const { runSetupCheck } = await import("@storytree/app-setup/setup");
    const report = await runSetupCheck({
      folder: context.cwd,
      ...(hook === undefined ? {} : { hook: { node: process.execPath, script: hook }, command: { path: process.env.PATH ?? process.env.Path ?? "", home: homedir() } }),
    });
    if (report.storytree.state === "not running") throw new Refusal(report.storytree.message);
    const { library } = report.storytree;
    const said = [
      library.cloudSql !== undefined
        ? `The library is on the Cloud SQL instance ${library.cloudSql.instance}, signed in to as ${library.cloudSql.user} (the library setting).`
        : report.storytree.state === "opened" ? "storytree was closed, so it has been opened." : "storytree is running.",
    ];
    said.push(...hooksSaid(report));
    const next = [];
    const setUp = args.text("set-up");
    const join = args.text("join");
    if (report.project.status === "set up") {
      const project = report.project.name;
      if (join === project) await joinHere(context.cwd, project, library);
      if (await approvedHere(context.cwd, project, library)) {
        said.push(join === project ? `This folder is storytree project "${project}"'s checkout on this machine now.` : `This folder is storytree project "${project}".`);
        said.push(await lastHook(library, project));
      } else {
        said.push(`This folder names storytree project "${project}", but it is not approved as "${project}"'s checkout on this machine, so storytree opens nothing and records nothing here.`);
        next.push({ command: `storytree doctor --join ${project}`, why: `approve this folder as "${project}"'s checkout, if it is yours` });
      }
    } else {
      const { connect } = await import("@storytree/library");
      const storytree = await connect(library);
      try {
        const project = join ?? setUp;
        if (project !== undefined) {
          await setUpProject({ folder: context.cwd, project, storytree, join: join !== undefined }).catch((error: unknown) => {
            throw error instanceof ProjectFolderError ? new Refusal(error.message) : error;
          });
          if (join === undefined) await context.journey?.().then((journey) => journey.projectCreated()).catch(() => {});
          said.push(join === undefined ? `This folder is set up as storytree project "${project}" now.` : `This folder is storytree project "${project}"'s checkout on this machine now.`);
        } else {
          said.push(`This folder is not a storytree project. Nothing was set up: storytree sets a folder up only when you tell it to.`);
          next.push({ command: `storytree doctor --set-up ${await suggestProjectName(context.cwd, storytree)}`, why: "make it a new project, or name it as you like" });
        }
      } finally {
        await storytree.close();
      }
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
  summary: "connect or disconnect agents; install or remove storytree's hooks",
  verbs: setupConnectionVerbs,
  bare: setup,
};

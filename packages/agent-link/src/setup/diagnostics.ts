/** The setup check's lines and fixes, shared by the terminal and the agent's check_setup tool. */
import { NODE_FLOOR, type AgentCliState, type MachineState } from "./machine.js";
import type { SetupReport } from "./setup.js";

export interface SetupLine {
  readonly check: "storytree" | "hooks" | "status-line" | "command" | "gh" | "agent-cli" | "git" | "node" | "project";
  readonly state: "ok" | "fixed" | "needs-attention" | "skipped";
  readonly message: string;
  readonly fix?: string;
}

export function setupLines(report: Omit<SetupReport, "lines">): SetupLine[] {
  const { storytree, hooks, command, gh, machine, project } = report;
  const lines: SetupLine[] = [storytree.state === "not running"
    ? { check: "storytree", state: "needs-attention", message: storytree.message, fix: "Open the storytree app and run the setup check again." }
    : { check: "storytree", state: storytree.state === "opened" ? "fixed" : "ok", message: storytree.state === "opened" ? "storytree was closed, so it has been opened." : "storytree is running." }];

  if (hooks === undefined) {
    lines.push({ check: "hooks", state: "skipped", message: "This check has no installed storytree hook command to register.", fix: "Run the check from an installed storytree." });
  } else {
    const name = (harness: "claude-code" | "codex") => harness === "codex" ? "Codex" : "Claude Code";
    const registered = (["claude-code", "codex"] as const).filter((harness) => hooks[harness] === "registered");
    // Name only the harnesses whose hooks are in place: not one that is not on this machine or was disconnected.
    const present = (["claude-code", "codex"] as const).filter((harness) => hooks[harness] === "registered" || hooks[harness] === "already registered");
    lines.push({ check: "hooks", state: registered.length > 0 ? "fixed" : "ok", message: registered.length > 0
      ? `storytree's hooks were registered for ${registered.map(name).join(" and ")}.`
      : present.length > 0
        ? `storytree's hooks are registered for ${present.map(name).join(" and ")}; receiving them is verified inside a session.`
        : "No harness here has storytree's hooks: neither Claude Code nor Codex is on this machine and connected." });
    lines.push({ check: "status-line", state: hooks.statusLine === "installed" ? "fixed" : "ok", message: hooks.statusLine === "installed"
      ? "storytree's status line was installed in Claude Code: it shows from the next session."
      : hooks.statusLine === "the user's own kept"
        ? "The user has a Claude Code status line of their own, so storytree's was not installed: storytree never replaces it."
        : "storytree's status line is installed in Claude Code." });
  }

  switch (command) {
    case "installed":
      lines.push({ check: "command", state: "fixed", message: "storytree put its storytree command on the user's path." });
      break;
    case "already installed":
      lines.push({ check: "command", state: "ok", message: "The storytree command is on the user's path." });
      break;
    case "another storytree kept":
      lines.push({ check: "command", state: "needs-attention", message: "There is already a storytree command of the user's own on their path, so storytree did not put its own there.", fix: "Choose which storytree command to keep before running the setup check again." });
      break;
    case "no folder of the user's on the path":
      lines.push({ check: "command", state: "needs-attention", message: "storytree found no writable folder of the user's own on their PATH.", fix: "Add a writable folder inside your home to PATH (such as ~/.local/bin), then run the setup check again." });
      break;
    default:
      lines.push({ check: "command", state: "skipped", message: "No command installation was requested." });
  }

  lines.push(gh === "signed in"
    ? { check: "gh", state: "ok", message: "GitHub's gh command is signed in." }
    : gh === "not answering"
      ? { check: "gh", state: "needs-attention", message: "GitHub's gh command did not answer whether it is signed in, so a claim may not end when its pull request merges.", fix: "Run `gh auth status` to see what it is waiting on, then run the setup check again." }
      : { check: "gh", state: "needs-attention", message: `GitHub's gh command is ${gh === "missing" ? "not installed" : "not signed in"}, so a claim will not end when its pull request merges.`, fix: gh === "missing" ? "Install gh from https://cli.github.com and run `gh auth login`." : "Run `gh auth login`." });
  lines.push(...machineLines(machine));
  lines.push(project.status === "set up"
    ? { check: "project", state: "ok", message: `This folder is storytree project ${JSON.stringify(project.name)}.` }
    : { check: "project", state: "needs-attention", message: "This folder isn't a storytree project yet.", fix: `Only after the user says yes, set up project ${JSON.stringify(project.suggestion)} or a name they choose (lower-case letters, digits and hyphens).` });
  return lines;
}

/** The agent CLI, git and Node lines: what a first run needs on the machine (ADR-0716). */
function machineLines(machine: MachineState): SetupLine[] {
  const seconds = `${Math.round(machine.waitMs / 1000)} seconds`;
  const cli = (name: string, state: AgentCliState): string =>
    state === "signed in" ? `${name} is installed and signed in`
      : state === "signed out" ? `${name} is installed and not signed in`
        : state === "missing" ? `${name} is not installed`
          : `${name} did not answer within ${seconds}`;
  const agentReady = machine.claude === "signed in" || machine.codex === "signed in";
  const signIns = [machine.claude === "signed out" ? "run `claude auth login`" : undefined, machine.codex === "signed out" ? "run `codex login`" : undefined].filter((fix) => fix !== undefined);
  const lines: SetupLine[] = [agentReady
    ? { check: "agent-cli", state: "ok", message: `${cli("Claude Code", machine.claude)}; ${cli("Codex", machine.codex)}.` }
    : {
        check: "agent-cli",
        state: "needs-attention",
        message: `storytree works through Claude Code or Codex, and neither is ready: ${cli("Claude Code", machine.claude)}; ${cli("Codex", machine.codex)}.`,
        fix: signIns.length > 0
          ? `To sign in, ${signIns.join(", or ")}, then run the setup check again.`
          : "Install Claude Code (https://claude.com/claude-code) or Codex (https://developers.openai.com/codex), sign in, then run the setup check again.",
      }];

  lines.push(machine.git === "present"
    ? { check: "git", state: "ok", message: "git is installed." }
    : { check: "git", state: "needs-attention", message: machine.git === "missing" ? "git is not installed." : `git did not answer within ${seconds}.`, fix: "Install git from https://git-scm.com, then run the setup check again." });

  const { node } = machine;
  lines.push(node.state === "ok"
    ? { check: "node", state: "ok", message: `Node ${node.version} is installed.` }
    : {
        check: "node",
        state: "needs-attention",
        message: node.state === "old" ? `Node ${node.version} is older than storytree needs.` : node.state === "missing" ? "Node is not installed." : `Node did not answer within ${seconds}.`,
        fix: `Install Node ${NODE_FLOOR} or later from https://nodejs.org, then run the setup check again.`,
      });
  return lines;
}

/** The setup check's lines and fixes, shared by the terminal and the agent's check_setup tool. */
import type { SetupReport } from "./setup.js";

export interface SetupLine {
  readonly check: "storytree" | "hooks" | "status-line" | "command" | "gh" | "project";
  readonly state: "ok" | "fixed" | "needs-attention" | "skipped";
  readonly message: string;
  readonly fix?: string;
}

export function setupLines(report: Omit<SetupReport, "lines">): SetupLine[] {
  const { storytree, hooks, command, gh, project } = report;
  const lines: SetupLine[] = [storytree.state === "not running"
    ? { check: "storytree", state: "needs-attention", message: storytree.message, fix: "Open the storytree app and run the setup check again." }
    : { check: "storytree", state: storytree.state === "opened" ? "fixed" : "ok", message: storytree.state === "opened" ? "storytree was closed, so it has been opened." : "storytree is running." }];

  if (hooks === undefined) {
    lines.push({ check: "hooks", state: "skipped", message: "This check has no installed storytree hook command to register.", fix: "Run the check from an installed storytree." });
  } else {
    const registered = (["claude-code", "codex"] as const).filter((harness) => hooks[harness] === "registered");
    lines.push({ check: "hooks", state: registered.length > 0 ? "fixed" : "ok", message: registered.length > 0
      ? `storytree's hooks were registered for ${registered.map((harness) => harness === "codex" ? "Codex" : "Claude Code").join(" and ")}.`
      : "storytree's hooks are registered for Claude Code and Codex; receiving them is verified inside a session." });
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
    : { check: "gh", state: "needs-attention", message: `GitHub's gh command is ${gh === "missing" ? "not installed" : "not signed in"}, so a claim will not end when its pull request merges.`, fix: gh === "missing" ? "Install gh from https://cli.github.com and run `gh auth login`." : "Run `gh auth login`." });
  lines.push(project.status === "set up"
    ? { check: "project", state: "ok", message: `This folder is storytree project ${JSON.stringify(project.name)}.` }
    : { check: "project", state: "needs-attention", message: "This folder isn't a storytree project yet.", fix: `Only after the user says yes, set up project ${JSON.stringify(project.suggestion)} or a name they choose (lower-case letters, digits and hyphens).` });
  return lines;
}

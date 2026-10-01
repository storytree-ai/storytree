/** The setup check's lines and fixes, shared by the terminal and the agent's check_setup tool. */
import { NODE_FLOOR, type AgentCliState, type MachineState } from "./machine.js";
import { CODEX_TRUST_STEP } from "./verify.js";
import type { SetupReport } from "./setup.js";
import type { AppReading } from "../sessions/app-records.js";
import { compareVersions } from "./hooks-release.js";

export interface SetupLine {
  readonly check: "storytree" | "hooks" | "hooks-release" | "codex-server" | "codex-hooks" | "elevated" | "transcripts" | "status-line" | "command" | "gh" | "agent-cli" | "git" | "node" | "archives" | "project";
  /** A `note` names an optional tool that is missing: never a fix, so no agent is asked to install it (question_bb3efa1e3191). */
  readonly state: "ok" | "fixed" | "needs-attention" | "skipped" | "note";
  readonly message: string;
  readonly fix?: string;
}

export function setupLines(report: Omit<SetupReport, "lines">): SetupLine[] {
  const { storytree, hooks, codexServer, codexHooks, command, gh, machine, project } = report;
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
    const replaced = [...new Set(Object.values(hooks.replaced ?? {}).flat())];
    lines.push({ check: "hooks", state: registered.length > 0 ? "fixed" : "ok", message: registered.length > 0
      ? `storytree's hooks were registered for ${registered.map(name).join(" and ")}${replaced.length > 0 ? `, replacing another build's hooks, which ran ${replaced.join(" and ")}` : ""}.`
      : present.length > 0
        ? `storytree's hooks are registered for ${present.map(name).join(" and ")}; receiving them is verified inside a session.`
        : "No harness here has storytree's hooks: neither Claude Code nor Codex is on this machine and connected." });
    if (present.length > 0) {
      // Said plainly, so neither the user nor an agent's own reviewer takes this check for what sends the transcript.
      lines.push({ check: "transcripts", state: "ok", message: "This check sends nothing of the session. storytree's hooks send each session's transcript into the library's shared log as the session works, so every machine's app can read it" +
        `${codexHooks === "waiting" ? "; in Codex they send nothing until the user trusts them" : ""}. ` +
        "Obvious secrets (API keys, bearer and OAuth tokens, private keys, connection-string passwords) are scrubbed before they leave this machine; " +
        "the scrub is best-effort, not a guarantee, so a secret in another shape can still reach the log. Raw transcript records are kept 180 days." });
    }
    lines.push({ check: "status-line", state: hooks.statusLine === "installed" ? "fixed" : "ok", message: hooks.statusLine === "installed"
      ? "storytree's status line was installed in Claude Code: it shows from the next session."
      : hooks.statusLine === "the user's own kept"
        ? "The user has a Claude Code status line of their own, so storytree's was not installed: storytree never replaces it."
        : "storytree's status line is installed in Claude Code." });
  }

  // The app updates the hooks it installed only while it runs: say when they run an older release (contract 8.18).
  const { running, latest } = report.hooksRelease;
  if (running !== undefined && latest !== undefined) lines.push(compareVersions(running, latest) < 0
    ? {
        check: "hooks-release",
        state: "needs-attention",
        message: `storytree's hooks run v${running}, but v${latest} is out: fixes since have not reached them, because the desktop app updates its hooks only while it runs.`,
        fix: "Open the storytree app and leave it running until it has updated.",
      }
    : { check: "hooks-release", state: "ok", message: `storytree's hooks run v${running}, the latest release.` });

  if (codexServer !== undefined) lines.push(codexServer.state === "registered"
    ? { check: "codex-server", state: "ok", message: "Codex has storytree's tool server." }
    : {
        check: "codex-server",
        state: "needs-attention",
        message: `Codex has no storytree tool server ([mcp_servers.storytree] in ${codexServer.config}), so Codex sessions get no storytree tools.`,
        fix: "Run `storytree setup connect --codex`, then start a new Codex session.",
      });

  if (report.codexHooks !== undefined) lines.push(report.codexHooks === "running"
    ? { check: "codex-hooks", state: "ok", message: "Codex runs storytree's hooks: one has reached storytree since they were registered." }
    : {
        check: "codex-hooks",
        state: "needs-attention",
        message: "Codex has storytree's hooks but has not run one yet: Codex runs them only once you have trusted them, so until then storytree cannot see Codex's work.",
        fix: CODEX_TRUST_STEP,
      });

  // Codex's own limit, not storytree's: from an administrator terminal its sandbox runs no command (8.17).
  if (machine.elevated === true && machine.codex !== "missing") lines.push({
    check: "elevated",
    state: "needs-attention",
    message: "This runs in an administrator (elevated) terminal, and Codex cannot run commands from one: its Windows sandbox times out on every command, so storytree never sees them.",
    fix: "Close this terminal, open a normal one (not \"Run as administrator\"), and start Codex from there.",
  });

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
    case undefined:
      lines.push({ check: "command", state: "skipped", message: "No command installation was requested." });
      break;
    default:
      // An older storytree launcher, repointed at this build: say which file changed and what it ran.
      lines.push({ check: "command", state: "fixed", message: `storytree put its storytree command on the user's path: ${command}.` });
  }

  const ghNow = gh === "not answering" ? "did not answer whether it is signed in" : gh === "missing" ? "is not installed" : "is not signed in";
  lines.push(gh === "signed in"
    ? { check: "gh", state: "ok", message: "GitHub's gh command is signed in." }
    : { check: "gh", state: "note", message: `GitHub's gh command ${ghNow}. storytree works without it: only a claim ending by itself when its pull request merges needs it.` });
  lines.push(...machineLines(machine));
  lines.push(archivesLine(report.archives));
  lines.push(project.status === "set up"
    ? { check: "project", state: "ok", message: `This folder is storytree project ${JSON.stringify(project.name)}.` }
    : { check: "project", state: "needs-attention", message: "This folder isn't a storytree project yet.", fix: `Only after the user says yes, set up project ${JSON.stringify(project.suggestion)} or a name they choose (lower-case letters, digits and hyphens).` });
  return lines;
}

/**
 * Whether the Claude desktop app's and Codex's session records could be read (ADR-0754 D4): a
 * session one of them keeps stays listed, shown done, until it is archived there. Without either,
 * sessions leave after the leave-after time instead: a note, never a fix.
 */
function archivesLine(archives: readonly AppReading[]): SetupLine {
  const name = (app: AppReading["app"]) => (app === "claude-desktop" ? "the Claude desktop app" : "Codex");
  const said = archives.map((reading) => reading.state === "read" ? `${name(reading.app)} keeps ${reading.sessions.size} session${reading.sessions.size === 1 ? "" : "s"}`
    : reading.state === "absent" ? `${name(reading.app)} keeps no session record on this machine`
      : `${name(reading.app)}'s session record could not be read (${reading.problem ?? "unknown reason"})`);
  const summary = said.join("; ");
  const capital = summary.charAt(0).toUpperCase() + summary.slice(1);
  return archives.some((reading) => reading.state === "read")
    ? { check: "archives", state: "ok", message: `${capital}. storytree reads which are archived there, and an archived session leaves the running-sessions list.` }
    : { check: "archives", state: "note", message: `${capital}. Sessions here leave the running-sessions list after the leave-after time instead of when archived.` };
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

  // git and Node are optional for a user: a note, never a fix (owner, 2026-09-29, question_bb3efa1e3191).
  lines.push(machine.git === "present"
    ? { check: "git", state: "ok", message: "git is installed." }
    : { check: "git", state: "note", message: `${machine.git === "missing" ? "git is not installed" : `git did not answer within ${seconds}`}. storytree works without it: only workspaces need it.` });

  const { node } = machine;
  lines.push(node.state === "ok"
    ? { check: "node", state: "ok", message: `Node ${node.version} is installed.` }
    : {
        check: "node",
        state: "note",
        message: `${node.state === "old" ? `The Node on the path, ${node.version}, is older than ${NODE_FLOOR}` : node.state === "missing" ? "There is no Node on the path" : `Node did not answer within ${seconds}`}. storytree runs on its own Node, so it does not need one.`,
      });
  return lines;
}

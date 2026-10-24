/**
 * Capability 3 · Hooks. The close-out reminder (ADR-0758 D4): when a Claude Code or Codex turn, or a Pi run, ends in a storytree
 * project, on a branch whose work has reached main, and the session has not closed out on this machine, the Stop
 * hook (Pi's agent_before_settle) asks it to, once per session. Only a session ending a turn is asked: an idle or
 * exited one is never woken.
 *
 * It decides from this machine alone, so a turn end never waits on the database: the folder's
 * branch (not main) is resolved when it has work of its own (its reflog records a commit on it)
 * and its head is already in origin/main as last fetched. A fresh workspace branch, still at the
 * main it was cut from, meets the second but not the first, so it is not asked and keeps its one
 * reminder for when its work does merge (friction_996acd8c8260). The close-out and the reminder
 * are each remembered per session beside the prompt hook's ledgers. The reading, not this, checks
 * the answer (Session management 4.12). It runs no git in a checkout this machine does not know as
 * approved (contract 3.46).
 */
import { currentBranch } from "../activity/branch.js";
import { runGit, type Git } from "../activity/git.js";
import { approvedHere, route } from "@storytree/project-and-caller";
import { alreadyGiven, notYetGivenIds } from "./given-once.js";

/** The flag of the Stop hook that asks the agent to close out. */
export const CLOSE_OUT_REMINDER = "--close-out-reminder";

const MAIN_BRANCHES = new Set(["main", "master"]);

/** Remember that `session` closed out on this machine, so the reminder no longer asks it. */
export function rememberClosedOut(session: string): void {
  notYetGivenIds(session, ["closed-out"], "close-outs");
}

/** The Stop hook's output (Pi's agent_before_settle answer) asking the agent to close out, or undefined when it is not to be asked. */
export function closeOutReminder(harness: string, input: unknown, git: Git = runGit): string | undefined {
  if ((harness !== "claude-code" && harness !== "codex" && harness !== "pi") || typeof input !== "object" || input === null) return undefined;
  const { hook_event_name: event, session_id: session, cwd: folder, stop_hook_active: again, outcome, continue: continuing } = input as Record<string, unknown>;
  // A turn the reminder itself caused is never asked again. Pi's run is asked only when it completed (an Escape
  // aborts it) and nothing else is continuing it: it settles again after that.
  const ends = harness === "pi" ? event === "agent_before_settle" && outcome === "completed" && continuing !== true : event === "Stop" && again !== true;
  if (!ends || typeof session !== "string" || typeof folder !== "string" || folder === "") return undefined;
  const where = route(folder);
  if (where.status === "not-a-project" || !approvedHere(where.project, folder)) return undefined;
  const branch = currentBranch(folder, git);
  if (branch === undefined || MAIN_BRANCHES.has(branch) || !inMain(folder, git) || !hasWorkOfItsOwn(folder, branch, git)) return undefined;
  // Closed out already, or asked already: asked once per session at most.
  if (alreadyGiven(session, "closed-out", "close-outs") || notYetGivenIds(session, ["asked"], "close-outs").length === 0) return undefined;
  const reason = `[storytree] ${branch} is in main now. If this session's work is done, close it out: \`storytree session close-out --safe yes|no --why <a few words>\` (or the close_out tool). Say yes only when every pull request has merged, the working tree is clean and nothing of yours is running; the sessions list checks a yes. If the work is not done, carry on.`;
  // Pi asks by an entry that becomes a message in the model's context, and one continuation of the run.
  if (harness === "pi") return JSON.stringify({ entries: [{ type: "custom_message", customType: "storytree-close-out", content: reason, display: true }], continue: true });
  return JSON.stringify({ decision: "block", reason });
}

/** Whether `folder`'s head is already in origin/main as last fetched. */
function inMain(folder: string, git: Git): boolean {
  try {
    git(["merge-base", "--is-ancestor", "HEAD", "origin/main"], { cwd: folder });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `branch` was ever committed to here: its reflog records a commit, a cherry-pick or a
 * merge that made a merge commit. Being cut from main, or fast-forwarded along it, records none.
 */
function hasWorkOfItsOwn(folder: string, branch: string, git: Git): boolean {
  try {
    const moves = git(["reflog", "show", "--format=%gs", `refs/heads/${branch}`, "--"], { cwd: folder });
    return moves.split("\n").some((move) => /^(commit|cherry-pick)\b/.test(move) || move.includes("Merge made by"));
  } catch {
    return false;
  }
}

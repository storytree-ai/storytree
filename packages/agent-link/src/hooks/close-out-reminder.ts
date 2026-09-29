/**
 * The close-out reminder (ADR-0758 D4): when a Claude Code turn ends in a storytree project, on a
 * branch whose work has reached main, and the session has not closed out on this machine, the Stop
 * hook asks it to, once per session. Only a session ending a turn is asked: an idle or exited one
 * is never woken.
 *
 * It decides from this machine alone, so a turn end never waits on the database: the folder's
 * branch (not main) is resolved when its head is already in origin/main as last fetched, which a
 * merged pull request or a branch with nothing ahead both give; and the close-out and the reminder
 * are each remembered per session beside the prompt hook's ledgers. The reading, not this, checks
 * the answer (agent link 4.12).
 */
import { execFileSync } from "node:child_process";

import { currentBranch } from "../activity/branch.js";
import { route } from "../routing/index.js";
import { alreadyGiven, notYetGivenIds } from "./given-once.js";

/** The flag of the Stop hook that asks the agent to close out. */
export const CLOSE_OUT_REMINDER = "--close-out-reminder";

const MAIN_BRANCHES = new Set(["main", "master"]);

/** Remember that `session` closed out on this machine, so the reminder no longer asks it. */
export function rememberClosedOut(session: string): void {
  notYetGivenIds(session, ["closed-out"], "close-outs");
}

/** The Stop hook's output asking the agent to close out, or undefined when it is not to be asked. */
export function closeOutReminder(harness: string, input: unknown): string | undefined {
  if (harness !== "claude-code" || typeof input !== "object" || input === null) return undefined;
  const { hook_event_name: event, session_id: session, cwd: folder, stop_hook_active: again } = input as Record<string, unknown>;
  // A turn the reminder itself caused is never asked again.
  if (event !== "Stop" || again === true || typeof session !== "string" || typeof folder !== "string" || folder === "") return undefined;
  if (route(folder).status === "not-a-project") return undefined;
  const branch = currentBranch(folder);
  if (branch === undefined || MAIN_BRANCHES.has(branch) || !inMain(folder)) return undefined;
  // Closed out already, or asked already: asked once per session at most.
  if (alreadyGiven(session, "closed-out", "close-outs") || notYetGivenIds(session, ["asked"], "close-outs").length === 0) return undefined;
  const reason = `[storytree] ${branch} is in main now. If this session's work is done, close it out: \`storytree session close-out --safe yes|no --why <a few words>\` (or the close_out tool). Say yes only when every pull request has merged, the working tree is clean and nothing of yours is running; the sessions list checks a yes. If the work is not done, carry on.`;
  return JSON.stringify({ decision: "block", reason });
}

/** Whether `folder`'s head is already in origin/main as last fetched. */
function inMain(folder: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], { cwd: folder, stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

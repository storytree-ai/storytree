// Capability 3 · Hooks
import { currentBranch } from "../activity/branch.js";
import { runGit, type Git } from "../activity/git.js";
import { approvedHere, route } from "@storytree/project-and-caller";
import { alreadyGiven, notYetGivenIds } from "./given-once.js";

export const CLOSE_OUT_REMINDER = "--close-out-reminder";

const MAIN_BRANCHES = new Set(["main", "master"]);

export const LANE_RUN = "STORYTREE_LANE_RUN";

export function rememberClosedOut(session: string): void {
  notYetGivenIds(session, ["closed-out"], "close-outs");
}

export function closeOutReminder(harness: string, input: unknown, git: Git = runGit, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env[LANE_RUN] || (harness !== "claude-code" && harness !== "codex" && harness !== "pi") || typeof input !== "object" || input === null) return undefined;
  const { hook_event_name: event, session_id: session, cwd: folder, stop_hook_active: again, outcome, continue: continuing } = input as Record<string, unknown>;
  const ends = harness === "pi" ? event === "agent_before_settle" && outcome === "completed" && continuing !== true : event === "Stop" && again !== true;
  if (!ends || typeof session !== "string" || typeof folder !== "string" || folder === "") return undefined;
  const where = route(folder);
  if (where.status === "not-a-project" || !approvedHere(where.project, folder)) return undefined;
  const branch = currentBranch(folder, git);
  if (branch === undefined || MAIN_BRANCHES.has(branch) || !inMain(folder, git) || !hasWorkOfItsOwn(folder, branch, git)) return undefined;
  if (alreadyGiven(session, "closed-out", "close-outs") || notYetGivenIds(session, ["asked"], "close-outs").length === 0) return undefined;
  const reason = `[storytree] ${branch} is in main now. If this session's work is done, close it out: \`storytree session close-out --safe yes|no --why <a few words>\` (or the close_out tool). Say yes only when every pull request has merged, the working tree is clean and nothing of yours is running; the sessions list checks a yes. If the work is not done, carry on.`;
  if (harness === "pi") return JSON.stringify({ entries: [{ type: "custom_message", customType: "storytree-close-out", content: reason, display: true }], continue: true });
  return JSON.stringify({ decision: "block", reason });
}

function inMain(folder: string, git: Git): boolean {
  try {
    git(["merge-base", "--is-ancestor", "HEAD", "origin/main"], { cwd: folder });
    return true;
  } catch {
    return false;
  }
}

function hasWorkOfItsOwn(folder: string, branch: string, git: Git): boolean {
  try {
    const moves = git(["reflog", "show", "--format=%gs", `refs/heads/${branch}`, "--"], { cwd: folder });
    return moves.split("\n").some((move) => /^(commit|cherry-pick)\b/.test(move) || move.includes("Merge made by"));
  } catch {
    return false;
  }
}

// Node-only: the shop's saved growth (ADR-0879 D7), with each stage's land surveyed from the shop's code as it
// stood at that stage's time: the latest commit on main's first-parent line by then, never the code of today.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Line } from "@storytree/agent-link";
import { codeSurveyReader, type ProjectSurvey } from "@storytree/forest/code-survey";
import type { AnnotatedTree, Change } from "@storytree/library";

const run = promisify(execFile);
const time = (value: string) => Date.parse(value);

/** Each landing on `branch`'s first-parent line, oldest first: its commit, its commit time and its subject. */
export async function landings(repository: string, branch = "main"): Promise<{ commit: string; at: string; subject: string }[]> {
  const { stdout } = await run("git", ["log", "--first-parent", branch, "--format=%H %cI %s"], { cwd: repository, encoding: "utf8", windowsHide: true });
  return stdout.trim().split("\n").filter(Boolean).map(row => {
    const [commit, at, ...subject] = row.split(" ");
    return { commit: commit!, at: new Date(at!).toISOString(), subject: subject.join(" ") };
  }).reverse();
}

/**
 * The survey of the repository's code as it stood at `at`: the latest first-parent commit on `branch` whose commit
 * time is no later, checked out into a throwaway worktree and surveyed for `plan`'s stories. Before any commit, no code.
 */
export function codeAt(repository: string, branch = "main"): (at: string, plan: AnnotatedTree) => Promise<ProjectSurvey> {
  const history = landings(repository, branch);
  return async (at, plan) => {
    const commit = (await history).filter(landing => time(landing.at) <= time(at)).at(-1)?.commit;
    if (commit === undefined) return {};
    const folder = await mkdtemp(path.join(tmpdir(), "growth-code-"));
    const checkout = path.join(folder, "checkout");
    await run("git", ["worktree", "add", "--detach", "--quiet", checkout, commit], { cwd: repository, windowsHide: true });
    try {
      return await codeSurveyReader({ checkout: "current" }).read(checkout, plan);
    } finally {
      await run("git", ["worktree", "remove", "--force", checkout], { cwd: repository, windowsHide: true }).catch(() => undefined);
      await rm(folder, { recursive: true, force: true });
    }
  };
}

const pullRequest = (subject: string) => /^Merge pull request #(\d+)/.exec(subject)?.[1];

/**
 * The moments the tour grows the shop through, all from its records: empty before its first change, planned just
 * before its first claim, each increment while it was being built (halfway from its last claim to the first landing
 * its session reported, or to its merge) and just after it landed (its pull request's merge or its closing, whichever
 * came later), and complete after the last record.
 */
export function shopStages(changes: readonly Change[], lines: readonly Line[], merges: readonly { at: string; subject: string }[]) {
  const seconds = (at: number, by: number) => new Date(at + by * 1000).toISOString();
  const first = Math.min(...changes.map(change => time(change.record.updatedAt)));
  const last = Math.max(...changes.map(change => time(change.record.updatedAt)), ...merges.map(merge => time(merge.at)));
  const window = { from: seconds(first, -60), to: seconds(last, 300) };
  const increments = new Map<string, { first: number; claimed: number; session?: string; closed?: number }>();
  for (const line of lines as readonly (Line & { increment?: string; capability?: string })[]) {
    if (!line.increment || line.capability) continue;
    const seen = increments.get(line.increment);
    if (line.kind === "claimed") increments.set(line.increment, { first: seen?.first ?? time(line.at), claimed: time(line.at), session: line.session, ...(seen?.closed ? { closed: seen.closed } : {}) });
    else if (line.kind === "closed" && seen) seen.closed = time(line.at);
  }
  const reported = (session: string | undefined, after: number) =>
    lines.filter(line => line.kind === "landed" && line.session === session && time(line.at) > after).map(line => time(line.at)).sort((a, b) => a - b)[0];
  const unmatched = merges.filter(merge => pullRequest(merge.subject) !== undefined && time(merge.at) > first);
  const stages: { id: string; at: string }[] = [{ id: "empty", at: window.from }];
  const order = [...increments.values()].sort((a, b) => a.first - b.first);
  if (order[0]) stages.push({ id: "planned", at: seconds(order[0].first, -1) });
  for (const increment of order) {
    const merge = unmatched.find(item => time(item.at) > increment.first);
    if (merge === undefined) continue;
    unmatched.splice(unmatched.indexOf(merge), 1);
    const name = `pr${pullRequest(merge.subject)}`;
    const built = Math.min(time(merge.at), reported(increment.session, increment.claimed) ?? Infinity);
    stages.push({ id: `${name}-building`, at: new Date((increment.claimed + built) / 2).toISOString() },
      { id: name, at: seconds(Math.max(time(merge.at), increment.closed ?? 0), 5) });
  }
  stages.push({ id: "complete", at: seconds(last, 60) });
  return { window, stages: stages.sort((a, b) => time(a.at) - time(b.at)) };
}

// Node-only: the shop's saved growth (ADR-0879 D7), with each stage's land surveyed from the shop's code as it
// stood at that stage's time: the latest commit on main's first-parent line by then, never the code of today.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Line } from "@storytree/agent-link";
import { codeSurveyReader, type ProjectSurvey } from "@storytree/forest/code-survey";
import { commitOfLog, judgeRun, parseTestLog, proofsAt, VERIFIED_BY_PROJECT_CI } from "@storytree/ci-health";
import type { AnnotatedCapability, AnnotatedTree, Change, HealthState } from "@storytree/library";

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

/** When a run finished: the latest time its log printed. */
const finishedAt = (log: string) => new Date(Math.max(...[...log.matchAll(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g)].map(([at]) => time(at)))).toISOString();
const rollUp = (states: readonly HealthState[]): HealthState =>
  states.includes("failing") ? "failing" : states.length > 0 && states.every(state => state === "passing") ? "passing" : "not-checked";

/**
 * The shop's verified health as storytree's CI health reading (ADR-0902) would have recorded it, run by run: each
 * push run on main (its archived log) judged against the test titles at the commit it tested, and each contract's
 * verdict that changed written as a verified health change dated when the run finished, by the project's CI. The
 * plan now (`tree`) carries the last run's verdicts. Nothing is written for a contract no run had a test for.
 */
export async function ciHealth(input: { tree: AnnotatedTree; changes: readonly Change[]; repository: string; runs: readonly { id: string; log: string }[] }): Promise<{ tree: AnnotatedTree; changes: Change[] }> {
  const git = async (args: string[]) => (await run("git", args, { cwd: input.repository, encoding: "utf8", maxBuffer: 1 << 28, windowsHide: true })).stdout;
  const runs = input.runs.map(item => ({ ...item, finished: finishedAt(item.log), commit: commitOfLog(item.log) })).sort((a, b) => time(a.finished) - time(b.finished));
  const latest = new Map<string, HealthState>();
  const changes = [...input.changes];
  let seq = Math.max(0, ...changes.map(change => change.seq));
  for (const item of runs) {
    if (item.commit === undefined) continue;
    const paths = (await git(["ls-tree", "-r", "--name-only", item.commit, "--", "packages"])).split("\n").filter(file => /^packages\/[^/]+\/.+\.[cm]?[jt]sx?$/.test(file)); // tests in a package's test folder too (CI health 3.4)
    const files = await Promise.all(paths.map(async file => ({ path: file, text: await git(["show", `${item.commit}:${file}`]) })));
    const { verdicts } = judgeRun(proofsAt(input.tree, files), parseTestLog(item.log));
    for (const [contract, verdict] of verdicts) {
      if (verdict.total === 0 || latest.get(contract) === verdict.state) continue;
      const id = `health_${contract}_verified`;
      const fields = { node: contract, column: "verified", state: verdict.state, by: VERIFIED_BY_PROJECT_CI, note: `${verdict.note}, at commit ${item.commit.slice(0, 12)}, run ${item.id}` };
      changes.push({ seq: ++seq, recordId: id, type: "health", action: latest.has(contract) ? "updated" : "created", record: { id, type: "health", version: 1, fields, createdAt: item.finished, updatedAt: item.finished } } as Change);
      latest.set(contract, verdict.state);
    }
  }
  if (latest.size === 0) return { tree: input.tree, changes };
  const verifiedOf = (contract: string): HealthState => latest.get(contract) ?? "not-checked";
  const { unverified: _, ...rest } = input.tree;
  const stories = input.tree.stories.map(story => {
    const capabilities = story.capabilities.map(capability => {
      const contracts = capability.contracts.map(contract => ({ ...contract, health: { ...contract.health, verified: { state: verifiedOf(contract.id) } } }));
      const verified = rollUp(contracts.map(contract => contract.health.verified.state));
      const { reportOnly: __, ...kept } = capability;
      return { ...kept, contracts, health: { ...capability.health, verified: { state: verified } },
        status: capability.proposed ? "proposed" : verified === "passing" ? "healthy" : verified === "failing" ? "unhealthy" : "untested" } as AnnotatedCapability;
    });
    return { ...story, capabilities, health: { ...story.health, verified: { state: rollUp(capabilities.flatMap(capability => capability.contracts.map(contract => contract.health.verified.state))) } } };
  });
  return { tree: { ...rest, stories }, changes };
}

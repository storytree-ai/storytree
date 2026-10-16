/**
 * Capability 5 · Per-merge points and curves (ADR-1064 D4). Every merge to an arm's main is one point: its merge number,
 * pull request, time and commit, the hidden tests' passed and total as that merge's `hidden-tests` run printed them, the
 * tree's files and bytes, and whether the arm's workflow on main is still the one it was seeded with. The points live
 * in this story's own table, `experiment_points`, beside the projects' libraries on the same server, and every row names
 * its project. `curves` reads them back as one series per arm.
 *
 * Each point also carries what the arm's lanes had cost and run into by its merge, read from the arm's own project
 * (`x-<experiment>-<arm>`) in the agent activity log: the tokens its sessions' stored transcripts say they spent, as
 * Session management's context reading folds them, and its collisions, the claim-refused and pr-red lines written by
 * then. And it carries the merge's rework: the lines it removes that one of the five merges before it added
 * (REWORK_WINDOW, the experiment record's measure), matched by file and text in each pull request's patches.
 *
 * A lane can merge a change to `.github/workflows/arm.yml`, which would let it see or fake the hidden tests' results,
 * and nothing else catches that: so each point says whether the workflow at its commit still equals `armWorkflowText`.
 */
import type { Storytree } from "@storytree/library";
import { openActivityLog, tokensSpent } from "@storytree/session-management";

import { ARM_WORKFLOW_PATH, ORGANISATION, armRepositoryName, armWorkflowText, ghCli, type ArmCi, type Gh } from "../repositories.js";

/** The database the points live in, beside the projects' libraries on the same server. */
export const POINTS_DATABASE = "storytree-experiments";

type Server = Pick<Storytree, "ownDatabase">;

/** The points' table, as idempotent statements the library applies once per connection, in order; later changes are appended. */
const SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS experiment_points (
    project         text NOT NULL,
    experiment      text NOT NULL,
    arm             text NOT NULL,
    merge           integer NOT NULL,
    pr              integer NOT NULL,
    merged_at       timestamptz NOT NULL,
    sha             text NOT NULL,
    passed          integer,
    total           integer,
    files           integer NOT NULL,
    bytes           bigint NOT NULL,
    workflow_intact boolean NOT NULL,
    recorded_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project, experiment, arm, merge),
    UNIQUE (project, experiment, arm, pr)
  )`,
  // Tokens and collisions to date, and rework (ADR-1064 D4): empty on points recorded before they were.
  `ALTER TABLE experiment_points ADD COLUMN IF NOT EXISTS tokens bigint`,
  `ALTER TABLE experiment_points ADD COLUMN IF NOT EXISTS claim_refusals integer`,
  `ALTER TABLE experiment_points ADD COLUMN IF NOT EXISTS reds integer`,
  `ALTER TABLE experiment_points ADD COLUMN IF NOT EXISTS conflicts integer`,
  `ALTER TABLE experiment_points ADD COLUMN IF NOT EXISTS rework integer`,
];

/** How many merges back a removed line counts as rework when one of them added it: the twin build's measure, "within 5 merges". */
export const REWORK_WINDOW = 5;

/** One merge on an arm's main, as its point records it. */
export interface Point {
  readonly merge: number;
  readonly pr: number;
  readonly mergedAt: string;
  readonly commit: string;
  /** The hidden tests' counts, undefined when the merge's verifier wrote no result. */
  readonly passed?: number;
  readonly total?: number;
  /** The tree at the merge: its files and their bytes, the file growth. */
  readonly files: number;
  readonly bytes: number;
  /** Whether the arm's workflow at this commit is still the one the repository was seeded with. */
  readonly workflowIntact: boolean;
  /** What the arm's sessions had spent by the merge, in tokens; absent on a point recorded before tokens were. */
  readonly tokens?: number;
  /** The arm's collisions by the merge: claims refused, and pull requests gone red, of which conflicts with main. */
  readonly claimRefusals?: number;
  readonly reds?: number;
  readonly conflicts?: number;
  /** The lines this merge removed that one of the REWORK_WINDOW merges before it added. */
  readonly rework?: number;
}

/** What `recordPoints` did: the points it wrote, and the merge it stopped at because its run has not finished. */
export interface Recorded {
  readonly written: readonly Point[];
  readonly waiting?: { readonly pr: number; readonly commit: string };
}

/** The arm whose merges are recorded: the experiment's and arm's names, as its repository is named, and the CI it was seeded with. */
export interface ArmOfExperiment {
  readonly experiment: string;
  readonly arm: string;
  readonly ci: ArmCi;
}

function database(server: Server) {
  return server.ownDatabase(POINTS_DATABASE, { tables: SCHEMA });
}

/** The counts the `hidden-tests` job prints; its last such line, since the log also carries the step's own text. */
export function countsOf(log: string): { passed: number; total: number } | undefined {
  const lines = [...log.matchAll(/passed=(\d+) total=(\d+)/g)];
  const last = lines.at(-1);
  return last === undefined ? undefined : { passed: Number(last[1]), total: Number(last[2]) };
}

interface Merged { readonly number: number; readonly mergedAt: string; readonly mergeCommit: { readonly oid: string } | null }
interface Job { readonly id: number; readonly name: string; readonly status: string; readonly conclusion: string | null }

/** The merge's `hidden-tests` job once it has finished, or undefined while its run is queued or running. */
function hiddenTestsJob(gh: Gh, repository: string, commit: string): Job | undefined {
  const runs = JSON.parse(gh(["run", "list", "--repo", repository, "--workflow", "arm.yml", "--event", "push", "--commit", commit, "--json", "databaseId,status"])) as { databaseId: number; status: string }[];
  for (const run of runs) {
    const { jobs } = JSON.parse(gh(["api", `repos/${repository}/actions/runs/${run.databaseId}/jobs`])) as { jobs: Job[] };
    const job = jobs.find((one) => one.name === "hidden-tests");
    if (job !== undefined && job.status === "completed") return job;
  }
  return undefined;
}

/** A pull request's changed files as GitHub lists them, a file's patch absent when GitHub leaves it out (a binary or a huge diff). */
interface ChangedFile { readonly filename: string; readonly previous_filename?: string; readonly patch?: string }

/** A changed line as rework matches it: its file and its text, a blank line never matching. */
const lineKey = (file: string, text: string): string | undefined => (text.trim() === "" ? undefined : `${file}\0${text}`);

/** The lines a pull request's patches add, or with `removed` remove (under the file's name before a rename), as keys. */
function changedLines(files: readonly ChangedFile[], removed: boolean): string[] {
  const keys: string[] = [];
  for (const file of files) {
    for (const line of (file.patch ?? "").split("\n")) {
      if (line.startsWith(removed ? "-" : "+") && !line.startsWith(removed ? "---" : "+++")) {
        const key = lineKey(removed ? (file.previous_filename ?? file.filename) : file.filename, line.slice(1));
        if (key !== undefined) keys.push(key);
      }
    }
  }
  return keys;
}

/** The lines `files` removes that `earlier`'s pull requests added, each added line matched at most once. */
function reworkOf(files: readonly ChangedFile[], earlier: readonly (readonly ChangedFile[])[]): number {
  const added = new Map<string, number>();
  for (const one of earlier) for (const key of changedLines(one, false)) added.set(key, (added.get(key) ?? 0) + 1);
  let rework = 0;
  for (const key of changedLines(files, true)) {
    const left = added.get(key) ?? 0;
    if (left === 0) continue;
    added.set(key, left - 1);
    rework += 1;
  }
  return rework;
}

/** What the arm had run into by a merge, from its claim-refused and pr-red lines. */
interface Collisions { readonly claimRefusals: number; readonly reds: number; readonly conflicts: number }

/** The point for one merge, read from GitHub. */
function pointOf(gh: Gh, repository: string, ci: ArmCi, merge: number, pr: Merged & { mergeCommit: { oid: string } }, job: Job): Point {
  const commit = pr.mergeCommit.oid;
  const counts = job.conclusion === "success" ? countsOf(gh(["api", `repos/${repository}/actions/jobs/${job.id}/logs`])) : undefined;
  const tree = JSON.parse(gh(["api", `repos/${repository}/git/trees/${commit}?recursive=1`])) as { truncated: boolean; tree: { type: string; size?: number }[] };
  if (tree.truncated) throw new Error(`${repository}'s tree at ${commit} is too large for GitHub to list whole, so its file growth cannot be read`);
  const blobs = tree.tree.filter((entry) => entry.type === "blob");
  let workflow: string | undefined;
  try {
    workflow = gh(["api", "-H", "Accept: application/vnd.github.raw", `repos/${repository}/contents/${ARM_WORKFLOW_PATH}?ref=${commit}`]);
  } catch {
    workflow = undefined;
  }
  return {
    merge,
    pr: pr.number,
    mergedAt: pr.mergedAt,
    commit,
    ...(counts === undefined ? {} : counts),
    files: blobs.length,
    bytes: blobs.reduce((sum, blob) => sum + (blob.size ?? 0), 0),
    workflowIntact: workflow === armWorkflowText(ci),
  };
}

/**
 * Writes a point for each merge to the arm's main not yet recorded, in merge order, and returns what it wrote. A merge
 * whose `hidden-tests` run has not finished stops it there, so points are always written in order; run it again later.
 */
export async function recordPoints(server: Storytree, project: string, { experiment, arm, ci }: ArmOfExperiment, gh: Gh = ghCli): Promise<Recorded> {
  // The arm's repository and its throwaway library share one name, `x-<experiment>-<arm>`.
  const armProject = armRepositoryName(experiment, arm);
  const repository = `${ORGANISATION}/${armProject}`;
  const pool = await database(server);
  const { rows } = await pool.query<{ pr: number }>("SELECT pr FROM experiment_points WHERE project = $1 AND experiment = $2 AND arm = $3", [project, experiment, arm]);
  const recorded = new Set(rows.map((row) => row.pr));
  const last = (await pool.query<{ merged_at: Date; tokens: string | null }>(
    "SELECT merged_at, tokens FROM experiment_points WHERE project = $1 AND experiment = $2 AND arm = $3 ORDER BY merge DESC LIMIT 1",
    [project, experiment, arm],
  )).rows[0];
  const log = await openActivityLog(server);
  const collisionLines = await log.lines(armProject, { kinds: ["claim-refused", "pr-red"], omit: ["checks", "reason"] });
  const collisionsBy = (at: number): Collisions => {
    const by = collisionLines.filter((line) => Date.parse(line.at) <= at);
    const reds = by.filter((line) => line.kind === "pr-red");
    return { claimRefusals: by.length - reds.length, reds: reds.length, conflicts: reds.filter((line) => line.kind === "pr-red" && line.conflict).length };
  };
  // Tokens to date add up from the last point's, so each point folds only the transcripts that grew since it.
  let tokens = last === undefined ? 0 : Number(last.tokens ?? Number.NaN);
  let after = last?.merged_at;
  const files = new Map<number, readonly ChangedFile[]>();
  const filesOf = (number: number): readonly ChangedFile[] => {
    let changed = files.get(number);
    if (changed === undefined) {
      changed = (JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repository}/pulls/${number}/files?per_page=100`])) as ChangedFile[][]).flat();
      files.set(number, changed);
    }
    return changed;
  };
  const merged = (JSON.parse(gh(["pr", "list", "--repo", repository, "--state", "merged", "--base", "main", "--limit", "10000", "--json", "number,mergedAt,mergeCommit"])) as Merged[])
    .filter((pr): pr is Merged & { mergeCommit: { oid: string } } => pr.mergeCommit !== null)
    .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt) || a.number - b.number);
  const written: Point[] = [];
  for (const [index, pr] of merged.entries()) {
    if (recorded.has(pr.number)) continue;
    const job = hiddenTestsJob(gh, repository, pr.mergeCommit.oid);
    if (job === undefined) return { written, waiting: { pr: pr.number, commit: pr.mergeCommit.oid } };
    const at = new Date(pr.mergedAt);
    tokens += await tokensSpent(log, armProject, after === undefined ? { upTo: at } : { upTo: at, after });
    after = at;
    const earlier = merged.slice(Math.max(0, index - REWORK_WINDOW), index).map((one) => filesOf(one.number));
    const point: Point = {
      ...pointOf(gh, repository, ci, index + 1, pr, job),
      // A run recorded before tokens were has no total to add to, so its later points have none either.
      ...(Number.isNaN(tokens) ? {} : { tokens }),
      ...collisionsBy(at.getTime()),
      rework: reworkOf(filesOf(pr.number), earlier),
    };
    await pool.query(
      `INSERT INTO experiment_points (project, experiment, arm, merge, pr, merged_at, sha, passed, total, files, bytes, workflow_intact, tokens, claim_refusals, reds, conflicts, rework)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) ON CONFLICT DO NOTHING`,
      [project, experiment, arm, point.merge, point.pr, point.mergedAt, point.commit, point.passed ?? null, point.total ?? null, point.files, point.bytes, point.workflowIntact,
        point.tokens ?? null, point.claimRefusals, point.reds, point.conflicts, point.rework],
    );
    written.push(point);
  }
  return { written };
}

/** An experiment's points, as one series per arm in merge order, the arms by name. */
export type Curves = Readonly<Record<string, readonly Point[]>>;

interface PointRow {
  arm: string; merge: number; pr: number; merged_at: Date; sha: string; passed: number | null; total: number | null;
  files: number; bytes: string; workflow_intact: boolean;
  tokens: string | null; claim_refusals: number | null; reds: number | null; conflicts: number | null; rework: number | null;
}

/** The experiment's curves in `project`: every point it has, grouped by arm. */
export async function curves(server: Server, project: string, experiment: string): Promise<Curves> {
  const pool = await database(server);
  const { rows } = await pool.query<PointRow>(
    "SELECT arm, merge, pr, merged_at, sha, passed, total, files, bytes, workflow_intact, tokens, claim_refusals, reds, conflicts, rework FROM experiment_points WHERE project = $1 AND experiment = $2 ORDER BY arm, merge",
    [project, experiment],
  );
  const series: Record<string, Point[]> = {};
  for (const row of rows) {
    (series[row.arm] ??= []).push({
      merge: row.merge,
      pr: row.pr,
      mergedAt: row.merged_at.toISOString(),
      commit: row.sha,
      ...(row.passed === null || row.total === null ? {} : { passed: row.passed, total: row.total }),
      files: row.files,
      bytes: Number(row.bytes),
      workflowIntact: row.workflow_intact,
      ...(row.tokens === null ? {} : { tokens: Number(row.tokens) }),
      ...(row.claim_refusals === null || row.reds === null || row.conflicts === null ? {} : { claimRefusals: row.claim_refusals, reds: row.reds, conflicts: row.conflicts }),
      ...(row.rework === null ? {} : { rework: row.rework }),
    });
  }
  return series;
}

/** The curves as text: a table per arm, one line per merge; a point whose workflow changed is flagged, its counts not to be trusted. */
export function curvesText(experiment: string, series: Curves): string {
  const arms = Object.keys(series);
  if (arms.length === 0) return `Experiment ${experiment} has no points yet: none of its arms' merges has been recorded.`;
  const lines: string[] = [];
  for (const arm of arms) {
    const points = series[arm]!;
    lines.push(`${arm}: ${points.length} merge${points.length === 1 ? "" : "s"}`);
    lines.push("  merge  pr     merged at             passed/total  share   files  bytes       tokens       refused  red  conflicts  rework");
    for (const point of points) {
      const counts = point.passed === undefined ? "no result" : `${point.passed}/${point.total}`;
      const share = point.passed === undefined || point.total === 0 ? "-" : `${((100 * point.passed) / point.total!).toFixed(1)}%`;
      const flag = point.workflowIntact ? "" : "  WORKFLOW CHANGED: counts not to be trusted";
      const measure = (value: number | undefined, width: number) => (value === undefined ? "-" : String(value)).padEnd(width);
      lines.push(`  ${String(point.merge).padEnd(5)}  #${String(point.pr).padEnd(5)} ${point.mergedAt.slice(0, 19).padEnd(20)}  ${counts.padEnd(12)}  ${share.padEnd(6)}  ${String(point.files).padEnd(5)}  ${String(point.bytes).padEnd(10)}  ${measure(point.tokens, 11)}  ${measure(point.claimRefusals, 7)}  ${measure(point.reds, 3)}  ${measure(point.conflicts, 9)}  ${measure(point.rework, 6)}`.trimEnd() + flag);
    }
  }
  return lines.join("\n");
}

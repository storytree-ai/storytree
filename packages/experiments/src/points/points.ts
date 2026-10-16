/**
 * Capability 5 · Per-merge points and curves (ADR-1064 D4). Every merge to an arm's main is one point: its merge number,
 * pull request, time and commit, the hidden tests' passed and total as that merge's `hidden-tests` run printed them, the
 * tree's files and bytes, and whether the arm's workflow on main is still the one it was seeded with. The points live
 * in this story's own table, `experiment_points`, beside the projects' libraries on the same server, and every row names
 * its project. `curves` reads them back as one series per arm.
 *
 * A lane can merge a change to `.github/workflows/arm.yml`, which would let it see or fake the hidden tests' results,
 * and nothing else catches that: so each point says whether the workflow at its commit still equals `armWorkflowText`.
 */
import type { Storytree } from "@storytree/library";

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
];

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
export async function recordPoints(server: Server, project: string, { experiment, arm, ci }: ArmOfExperiment, gh: Gh = ghCli): Promise<Recorded> {
  const repository = `${ORGANISATION}/${armRepositoryName(experiment, arm)}`;
  const pool = await database(server);
  const { rows } = await pool.query<{ pr: number }>("SELECT pr FROM experiment_points WHERE project = $1 AND experiment = $2 AND arm = $3", [project, experiment, arm]);
  const recorded = new Set(rows.map((row) => row.pr));
  const merged = (JSON.parse(gh(["pr", "list", "--repo", repository, "--state", "merged", "--base", "main", "--limit", "10000", "--json", "number,mergedAt,mergeCommit"])) as Merged[])
    .filter((pr): pr is Merged & { mergeCommit: { oid: string } } => pr.mergeCommit !== null)
    .sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt) || a.number - b.number);
  const written: Point[] = [];
  for (const [index, pr] of merged.entries()) {
    if (recorded.has(pr.number)) continue;
    const job = hiddenTestsJob(gh, repository, pr.mergeCommit.oid);
    if (job === undefined) return { written, waiting: { pr: pr.number, commit: pr.mergeCommit.oid } };
    const point = pointOf(gh, repository, ci, index + 1, pr, job);
    await pool.query(
      `INSERT INTO experiment_points (project, experiment, arm, merge, pr, merged_at, sha, passed, total, files, bytes, workflow_intact)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT DO NOTHING`,
      [project, experiment, arm, point.merge, point.pr, point.mergedAt, point.commit, point.passed ?? null, point.total ?? null, point.files, point.bytes, point.workflowIntact],
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
}

/** The experiment's curves in `project`: every point it has, grouped by arm. */
export async function curves(server: Server, project: string, experiment: string): Promise<Curves> {
  const pool = await database(server);
  const { rows } = await pool.query<PointRow>(
    "SELECT arm, merge, pr, merged_at, sha, passed, total, files, bytes, workflow_intact FROM experiment_points WHERE project = $1 AND experiment = $2 ORDER BY arm, merge",
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
    lines.push("  merge  pr     merged at             passed/total  share   files  bytes");
    for (const point of points) {
      const counts = point.passed === undefined ? "no result" : `${point.passed}/${point.total}`;
      const share = point.passed === undefined || point.total === 0 ? "-" : `${((100 * point.passed) / point.total!).toFixed(1)}%`;
      const flag = point.workflowIntact ? "" : "  WORKFLOW CHANGED: counts not to be trusted";
      lines.push(`  ${String(point.merge).padEnd(5)}  #${String(point.pr).padEnd(5)} ${point.mergedAt.slice(0, 19).padEnd(20)}  ${counts.padEnd(12)}  ${share.padEnd(6)}  ${String(point.files).padEnd(5)}  ${point.bytes}${flag}`);
    }
  }
  return lines.join("\n");
}

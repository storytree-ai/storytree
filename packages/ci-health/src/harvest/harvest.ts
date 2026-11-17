/**
 * Capability 3 · Reading the project's CI. The harvest of every failed CI run (ADR-1356 D2, research_f0fba6695fbd sections
 * 1 and 2): each failed GitHub Actions run of the window is sorted once, by run id, and never again.
 *
 * - A run of a workflow that tests no code (a release, a staging build, a Windows update) is infra, and so is one whose red
 *   jobs only timed out or were cancelled; own health's are skipped, since 5.33 already routes them (3.25).
 * - A CI run's failing tests are read by the watcher's own reading (the agent runner's `readFailures`, through its declared
 *   interface), and sorted by its flake rules: a test outside what the pull request changes, one whose head later passed
 *   unchanged, or one in a merge-queue red the watcher reads as a flake (`queueOutcome`) is a flake, and goes to the one
 *   investigation of that test (`investigateFlakyTest`, ADR-1352), never a second flake record (3.26).
 * - A test that failed at a head and passed only once the pull request changed code it reaches is a real failure, and so is
 *   every increment that landed fixing an escape; each is recorded once as an escape pattern, unjudged, for the agent that
 *   runs the harvest to judge whether it generalises (3.27).
 *
 * A run nothing settles yet (its pull request still red, say) is left for the next harvest, until it is as old as the
 * window, when it is recorded unsettled; every count is printed, so nothing is dropped silently.
 */
import { pathToFileURL } from "node:url";

import type { FieldsOf, Library, SchemaRecord, WriteOptions } from "@storytree/library";

import type { ScopeRule } from "../ci-times/record.js";
import type { GitHub } from "../read-ci/read-ci.js";
import { investigateFlakyTest, placeOf } from "../investigate/investigate.js";

/** The workflows whose runs test code: every other workflow's failed run is infra. */
export const CODE_WORKFLOWS: ReadonlySet<string> = new Set(["CI"]);
/** Own health's workflow, whose failures contract 5.33 already routes. */
export const OWN_HEALTH = "Own health";
/** The title the library gives the arc of a flaky test's one investigation (investigateFlake, 5.33), naming the test. */
const INVESTIGATION = /^The flaky test "(.*)" passes reliably$/;
/** Who the harvest's flakes and patterns are by. */
const BY = "storytree health harvest";

/** A failed GitHub Actions run, as the harvest lists it. */
export interface FailedRun {
  readonly id: number;
  readonly attempt: number;
  readonly workflow: string;
  readonly event: string;
  readonly head: string;
  readonly branch: string;
  readonly conclusion: string;
  readonly createdAt: string;
  /** Its pull request: a pull request run's own, or the one a merge-queue branch names. */
  readonly pr?: number;
}

/** One job of a run, as the watcher's readFailures reads it. */
export interface RunJob {
  readonly name: string;
  readonly conclusion: string | null;
  readonly steps: number;
  readonly log: string;
}

/** What a run's failing tests are sorted by, read from GitHub. */
export interface RunFacts {
  readonly jobs: readonly RunJob[];
  /** Its pull request, when the run did not name it (one merged since, found by its branch). */
  readonly pr?: number;
  /** The packages and apps its pull request changes (reachOf), empty for a run on no pull request. */
  readonly reach: ReadonlySet<string>;
  /** Whether a later run of its workflow at the same head passed: the same code, rerun green. */
  readonly passedSameHead: boolean;
  /** What the watcher reads a merge-queue red as (queueOutcome), for a run on the merge queue. */
  readonly queue?: "flake" | "real" | "ahead" | "unknown";
  /** The head its pull request was next green at, and the packages the change from the failing head to it reaches. */
  readonly laterGreen?: { readonly head: string; readonly reaches: (unit: string) => boolean };
}

/** The watcher's reading of a red, from the agent runner's declared interface (its `./watch`). */
export interface WatcherReading {
  readFailures(runs: readonly { id: number; attempt: number; repo: string; jobs: readonly RunJob[] }[], reach: ReadonlySet<string>): {
    outside: boolean; units: string[]; tests: string[]; where: Record<string, string>;
  };
  reachOf(files: readonly string[]): Set<string>;
  queueOutcome(red: { parents: readonly string[] }, at: { merged: boolean; head?: string; reached?: boolean }): "flake" | "real" | "ahead" | "unknown";
  onMain(status: string): boolean;
}

/** The watcher's reading, as the agent runner on this computer answers it (its own, or the stand-in's). */
export async function watcherReading(): Promise<WatcherReading> {
  const { agentRunnerEntry } = await import("@storytree/agent-pool/interface");
  return (await import(pathToFileURL(agentRunnerEntry("./watch")).href)) as WatcherReading;
}

/** One failing test of a CI run, sorted. */
export interface SortedTest {
  readonly test: string;
  readonly unit?: string;
  readonly verdict: "flake" | "real" | "undecided";
  readonly why: string;
}

/** What one failed run is. */
export type RunSort =
  | { readonly kind: "infra"; readonly why: string }
  | { readonly kind: "own-health" }
  | { readonly kind: "no-test"; readonly units: readonly string[] }
  | { readonly kind: "tests"; readonly tests: readonly SortedTest[] };

/** Whether `run` is sorted without reading its jobs: a workflow that tests no code, own health's, or a run that only timed out or was cancelled. */
export function sortByWorkflow(run: FailedRun): RunSort | undefined {
  if (run.workflow === OWN_HEALTH) return { kind: "own-health" };
  if (!CODE_WORKFLOWS.has(run.workflow)) return { kind: "infra", why: `${run.workflow} tests no code` };
  if (run.conclusion === "timed_out" || run.conclusion === "cancelled") return { kind: "infra", why: `the run ${run.conclusion === "timed_out" ? "timed out" : "was cancelled"}` };
  return undefined;
}

/**
 * What a CI run's failing tests are (3.26, 3.27), by the watcher's reading: none when its red jobs only timed out or were
 * cancelled (infra), or named no test; else each test a flake (outside what the pull request changes, its head rerun green,
 * or a queue red the watcher read as a flake, or green later with no change reaching it), real (green only once the pull
 * request changed code it reaches), or undecided.
 */
export function sortRun(run: FailedRun, facts: RunFacts, watcher: WatcherReading): RunSort {
  const byWorkflow = sortByWorkflow(run);
  if (byWorkflow !== undefined) return byWorkflow;
  const red = facts.jobs.filter((job) => job.conclusion !== "success" && job.conclusion !== "skipped" && job.conclusion !== null);
  if (red.length > 0 && red.every((job) => job.conclusion === "timed_out" || job.conclusion === "cancelled")) {
    return { kind: "infra", why: "its red jobs only timed out or were cancelled" };
  }
  const failures = watcher.readFailures([{ id: run.id, attempt: run.attempt, repo: "", jobs: facts.jobs }], facts.reach);
  if (failures.tests.length === 0) return { kind: "no-test", units: failures.units };
  const tests = failures.tests.map((test): SortedTest => {
    const unit = failures.where[test];
    const placed = unit === undefined ? {} : { unit };
    if (failures.outside) return { test, ...placed, verdict: "flake", why: "it failed outside what its pull request changes" };
    if (facts.passedSameHead) return { test, ...placed, verdict: "flake", why: `its head ${run.head.slice(0, 12)} passed on a rerun, unchanged` };
    if (facts.queue === "flake") return { test, ...placed, verdict: "flake", why: "the merge queue's red merged at the head it was red at" };
    const green = facts.laterGreen;
    if (green === undefined || green.head === run.head || unit === undefined) {
      return { test, ...placed, verdict: "undecided", why: unit === undefined ? "its run named no unit for it" : "its pull request has not passed since" };
    }
    return green.reaches(unit)
      ? { test, ...placed, verdict: "real", why: `it failed at ${run.head.slice(0, 12)} and passed only at ${green.head.slice(0, 12)}, once the pull request changed code ${unit} reaches` }
      : { test, ...placed, verdict: "flake", why: `it passed at ${green.head.slice(0, 12)} with no change reaching ${unit}` };
  });
  return { kind: "tests", tests };
}

/** The harvested runs, by run id: each sorted once (3.25). */
export interface HarvestLedger {
  harvested(ids: readonly number[]): Promise<ReadonlySet<number>>;
  mark(rows: readonly { id: number; sorted: string }[]): Promise<void>;
}

/** What the harvest reads GitHub through. */
export interface HarvestSource {
  failedRuns(since: Date): Promise<readonly FailedRun[]>;
  facts(run: FailedRun): Promise<RunFacts>;
}

/** What one harvest sorted, as it prints it (3.27). */
export interface HarvestCounts {
  readonly runs: number;
  readonly already: number;
  readonly infra: number;
  readonly ownHealth: number;
  readonly noTest: number;
  readonly waiting: number;
  readonly unsettled: number;
  readonly flakes: number;
  readonly investigations: readonly string[];
  readonly real: number;
  readonly escaped: number;
  readonly unjudged: number;
  readonly generalise: number;
  readonly unread: number;
}

/** The library the harvest writes through: its plan tree, flake investigations, and escape patterns. */
export type HarvestLibrary = Pick<Library, "projectTree" | "investigateFlake" | "writeKnowledge" | "list">;

/** The capability whose contracts hold `contract` in `tree`. */
function capabilityOf(library: Awaited<ReturnType<Library["projectTree"]>>, contract: string | undefined): string | undefined {
  if (contract === undefined) return undefined;
  for (const story of library.stories) for (const capability of story.capabilities) if (capability.contracts.some(({ id }) => id === contract)) return capability.id;
  return undefined;
}

/**
 * Harvest every failed run created in the `days` before `now` (3.25 to 3.27): sort each not yet harvested, send its
 * flakes to their investigations, record its real failures and every increment that landed fixing an escape as escape
 * patterns, once each, and mark the run harvested; a run nothing settles yet waits for the next harvest, until it is as
 * old as the window.
 */
export async function harvest({ library, source, ledger, watcher, now = new Date(), days = 7, write = {} }: {
  library: HarvestLibrary; source: HarvestSource; ledger: HarvestLedger; watcher: WatcherReading; now?: Date; days?: number; write?: WriteOptions;
}): Promise<HarvestCounts> {
  const windowMs = days * 86_400_000;
  const runs = await source.failedRuns(new Date(now.getTime() - windowMs));
  const done = await ledger.harvested(runs.map(({ id }) => id));
  const patterns = await library.list("escape");
  const recorded = new Set(patterns.flatMap(({ fields }) => [
    ...(fields.instance.run === undefined || fields.instance.test === undefined ? [] : [`${fields.instance.run}\n${fields.instance.test}`]),
    ...(fields.instance.escape === undefined ? [] : [fields.instance.escape]),
  ]));
  let tree: Awaited<ReturnType<Library["projectTree"]>> | undefined;
  const treeOf = async () => (tree ??= await library.projectTree());
  const counts = { runs: runs.length, already: 0, infra: 0, ownHealth: 0, noTest: 0, waiting: 0, unsettled: 0, flakes: 0, real: 0, escaped: 0, unread: 0 };
  const investigations = new Set<string>();
  const written: SchemaRecord<"escape">[] = [];
  const marks: { id: number; sorted: string }[] = [];

  const sortedRuns: { run: FailedRun; pr: number | undefined; tests: readonly SortedTest[] }[] = [];
  for (const run of runs) {
    if (done.has(run.id)) { counts.already++; continue; }
    let sorted = sortByWorkflow(run);
    let pr = run.pr;
    if (sorted === undefined) {
      try {
        const facts = await source.facts(run);
        pr ??= facts.pr;
        sorted = sortRun(run, facts, watcher);
      } catch {
        counts.unread++; // GitHub could not be read for it: the next harvest reads it again
        continue;
      }
    }
    if (sorted.kind === "infra") { counts.infra++; marks.push({ id: run.id, sorted: "infra" }); continue; }
    if (sorted.kind === "own-health") { counts.ownHealth++; marks.push({ id: run.id, sorted: "own-health" }); continue; }
    if (sorted.kind === "no-test") { counts.noTest++; marks.push({ id: run.id, sorted: "no-test" }); continue; }
    sortedRuns.push({ run, pr, tests: sorted.tests });
  }

  // A test already under investigation as a flaky test (ADR-1352), or one that flaked in another run of the window, is a
  // flake wherever else it failed: it joins its one investigation, never becomes an escape pattern.
  const increments = await library.list("increment");
  const investigating = new Set(increments.filter(({ fields }) => fields.status !== "closed").map(({ fields }) => fields.arc));
  const flaky = new Map<string, string>();
  for (const arc of await library.list("arc")) {
    const test = INVESTIGATION.exec(arc.fields.title)?.[1];
    if (test !== undefined && investigating.has(arc.id)) flaky.set(test, `it is under investigation as a flaky test (${arc.id})`);
  }
  for (const { run, tests } of sortedRuns) for (const one of tests) if (one.verdict === "flake" && !flaky.has(one.test)) flaky.set(one.test, `it flaked in run ${run.id} too`);

  for (const { run, pr, tests: read } of sortedRuns) {
    const tests = read.map((one): SortedTest => (one.verdict !== "flake" && flaky.has(one.test) ? { ...one, verdict: "flake", why: flaky.get(one.test)! } : one));
    const old = now.getTime() - Date.parse(run.createdAt) >= windowMs - 86_400_000;
    if (tests.some(({ verdict }) => verdict === "undecided") && !old) { counts.waiting++; continue; }
    const where = `run ${run.id}${pr === undefined ? "" : ` (PR #${pr})`} at ${run.head.slice(0, 12)}`;
    for (const one of tests) {
      if (one.verdict === "undecided") continue;
      if (one.verdict === "flake") {
        const id = await investigateFlakyTest(library as Library, {
          test: one.test, ...(one.unit === undefined ? {} : { unit: one.unit }), seen: `run ${run.id}`, by: BY,
          evidence: `${where} (${run.event}): the harvest read it as a flake, since ${one.why}.`,
          found: `The daily harvest of failed CI runs found it failing ${where}`,
        }, write);
        counts.flakes++;
        if (id !== undefined) investigations.add(id);
        continue;
      }
      if (recorded.has(`${run.id}\n${one.test}`)) continue;
      const place = placeOf(await treeOf(), one.unit === undefined ? {} : { unit: one.unit }, one.test);
      const capability = capabilityOf(await treeOf(), place.contract);
      written.push(await library.writeKnowledge("escape", {
        title: `Unjudged: "${one.test}" failed ${where}`,
        description: `A real failure CI caught on ${run.workflow} (${run.event}), waiting for the agent's judgement of its class and whether it generalises.`,
        instance: {
          run: run.id, ...(pr === undefined ? {} : { pr }), head: run.head, test: one.test,
          ...(place.contract === undefined ? {} : { contract: place.contract }), ...(place.story === undefined ? {} : { story: place.story }),
          ...(capability === undefined ? {} : { capability }),
        },
        caughtAt: "ci",
        reasoning: `Real, not a flake: ${one.why}.`,
      }, write));
      recorded.add(`${run.id}\n${one.test}`);
      counts.real++;
    }
    if (tests.some(({ verdict }) => verdict === "undecided")) counts.unsettled++;
    marks.push({ id: run.id, sorted: tests.some(({ verdict }) => verdict === "real") ? "real" : tests.every(({ verdict }) => verdict === "flake") ? "flake" : "unsettled" });
  }

  // Every increment that landed fixing an escape is a real failure every layer missed (3.27).
  for (const increment of increments) {
    const escape = (increment.fields as FieldsOf<"increment">).escape;
    if (escape === undefined || escape === "none" || recorded.has(increment.id)) continue;
    const pr = /^#?(\d+)$/.exec(escape.causedBy)?.[1];
    written.push(await library.writeKnowledge("escape", {
      title: `Unjudged: the escape ${increment.id} fixed`,
      description: `A defect that reached main, caused by ${escape.causedBy}, fixed by "${increment.fields.title}"; waiting for the agent's judgement of its class and whether it generalises.`,
      instance: {
        ...(pr === undefined ? {} : { pr: Number(pr) }), ...(escape.commit === undefined ? {} : { head: escape.commit }),
        story: escape.story, escape: increment.id,
      },
      caughtAt: "escaped",
      reasoning: `Real: ${increment.id} landed fixing an escape caused by ${escape.causedBy}, which reached main past every layer.`,
    }, write));
    recorded.add(increment.id);
    counts.escaped++;
  }

  await ledger.mark(marks);
  const all = [...patterns, ...written];
  return {
    ...counts,
    investigations: [...investigations],
    unjudged: all.filter(({ fields }) => fields.generalises === undefined).length,
    generalise: all.filter(({ fields }) => fields.generalises === "yes").length,
  };
}

/** What a harvest printed, in plain words (3.27). */
export function harvestText(counts: HarvestCounts): string {
  const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  return [
    `Harvested ${plural(counts.runs - counts.already, "failed run")} (${counts.already} already harvested before):`,
    `  infra: ${counts.infra} (a workflow that tests no code, or only a timeout or a cancel); own health's, skipped: ${counts.ownHealth}; red on no named test: ${counts.noTest}`,
    `  flakes routed: ${plural(counts.flakes, "flaky test")} to ${plural(counts.investigations.length, "investigation")}${counts.investigations.length === 0 ? "" : ` (${counts.investigations.join(", ")})`}`,
    `  real failures recorded: ${counts.real} caught by CI, ${counts.escaped} that reached main`,
    `  left for the next harvest: ${counts.waiting} not yet settled, ${counts.unread} GitHub could not read; recorded unsettled at the window's end: ${counts.unsettled}`,
    `Escape patterns: ${counts.generalise} generalise; ${counts.unjudged} wait for the agent's judgement (library list escape; library edit <id> with --title, --construct, --elsewhere, --generalises yes|no|local and --generalisesWhy).`,
  ].join("\n");
}

/** A failed run as GitHub's REST API lists it. */
interface ApiRun {
  id: number; run_attempt: number; name: string; event: string; head_sha: string; head_branch: string | null; conclusion: string | null;
  created_at: string; pull_requests?: { number: number }[];
}

/** The pull request a merge-queue branch (`gh-readonly-queue/main/pr-<n>-<sha>`) names. */
export function queuedPr(branch: string): number | undefined {
  const found = /^gh-readonly-queue\/[^/]+\/pr-(\d+)-/.exec(branch)?.[1];
  return found === undefined ? undefined : Number(found);
}

/**
 * The harvest's reading of `repository` on GitHub (3.25 to 3.27): its failed and timed-out runs since a time, and each CI
 * run's facts: its jobs with their logs, its pull request's reach, whether its head later passed unchanged, a merge-queue
 * red's outcome as the watcher reads it, and the head the pull request was next green at with what the change to it reaches.
 */
export function gitHubSource(github: GitHub, repository: string, watcher: WatcherReading, scope: ScopeRule): HarvestSource {
  const api = `repos/${repository}`;
  const listed = async (route: string): Promise<ApiRun[]> => {
    const runs: ApiRun[] = [];
    for (let page = 1; page <= 10; page++) {
      const { workflow_runs: some } = (await github.json(`${route}&per_page=100&page=${page}`)) as { workflow_runs: ApiRun[] };
      runs.push(...some);
      if (some.length < 100) break;
    }
    return runs;
  };
  const green = async (query: string, workflow: string): Promise<ApiRun[]> =>
    (await listed(`${api}/actions/runs?${query}&status=success`)).filter((one) => one.name === workflow);
  // What the pull request's own change from one head to another reaches: the files both changed between them and in the
  // pull request, so main merged into its branch in between is not counted as its change.
  const reachesFrom = async (from: string, to: string, own: ReadonlySet<string>): Promise<(unit: string) => boolean> => {
    const { files } = (await github.json(`${api}/compare/${from}...${to}`)) as { files?: { filename: string }[] };
    const decided = scope((files ?? []).map(({ filename }) => filename).filter((file) => own.has(file)));
    return (unit) => decided.full || decided.dirs.includes(unit);
  };
  return {
    async failedRuns(since) {
      const day = since.toISOString().slice(0, 10);
      const runs = [...await listed(`${api}/actions/runs?status=failure&created=>=${day}`), ...await listed(`${api}/actions/runs?status=timed_out&created=>=${day}`)];
      const seen = new Set<number>();
      return runs.filter((one) => !seen.has(one.id) && (seen.add(one.id), Date.parse(one.created_at) >= since.getTime())).map((one) => {
        const pr = one.pull_requests?.[0]?.number ?? queuedPr(one.head_branch ?? "");
        return {
          id: one.id, attempt: one.run_attempt, workflow: one.name, event: one.event, head: one.head_sha, branch: one.head_branch ?? "",
          conclusion: one.conclusion ?? "failure", createdAt: one.created_at, ...(pr === undefined ? {} : { pr }),
        };
      });
    },
    async facts(run) {
      const { jobs: listedJobs } = (await github.json(`${api}/actions/runs/${run.id}/attempts/${run.attempt}/jobs?per_page=100`)) as {
        jobs: { id: number; name: string; conclusion: string | null; steps?: unknown[] }[];
      };
      const jobs = await Promise.all(listedJobs.map(async (job) => ({
        name: job.name, conclusion: job.conclusion, steps: job.steps?.length ?? 0,
        log: job.conclusion === "failure" || job.conclusion === "timed_out" ? await github.text(`${api}/actions/jobs/${job.id}/logs`) : "",
      })));
      const passedSameHead = (await green(`head_sha=${run.head}`, run.workflow)).length > 0;
      // A pull request's run lists its pull request only while it is open: one merged since is found by its branch.
      const number = run.pr ?? (run.event === "pull_request" && run.branch !== ""
        ? ((await github.json(`${api}/pulls?head=${repository.split("/")[0]}:${encodeURIComponent(run.branch)}&state=all&per_page=1`)) as { number: number }[])[0]?.number
        : undefined);
      if (number === undefined) return { jobs, reach: new Set(), passedSameHead };
      const named = run.pr === undefined ? { pr: number } : {};
      const pull = (await github.json(`${api}/pulls/${number}`)) as { merged?: boolean; head: { sha: string; ref: string } };
      const files: { filename: string }[] = [];
      for (let page = 1; page <= 30; page++) {
        const some = (await github.json(`${api}/pulls/${number}/files?per_page=100${page === 1 ? "" : `&page=${page}`}`)) as { filename: string }[];
        files.push(...some);
        if (some.length < 100) break;
      }
      const own = new Set(files.map(({ filename }) => filename));
      const reach = watcher.reachOf([...own]);
      if (run.event === "merge_group") {
        // The queue's commit: its first parent main or the entry ahead, its second the pull request's head it was red at.
        const { parents } = (await github.json(`${api}/commits/${run.head}`)) as { parents: { sha: string }[] };
        const shas = parents.map(({ sha }) => sha);
        const base = shas[0];
        const reached = base === undefined ? undefined : watcher.onMain(((await github.json(`${api}/compare/main...${base}`)) as { status: string }).status);
        const queue = watcher.queueOutcome({ parents: shas }, { merged: pull.merged === true, head: pull.head.sha, ...(reached === undefined ? {} : { reached }) });
        const redAt = shas[1];
        const laterGreen = pull.merged === true && redAt !== undefined && redAt !== pull.head.sha ? { head: pull.head.sha, reaches: await reachesFrom(redAt, pull.head.sha, own) } : undefined;
        return { jobs, ...named, reach, passedSameHead, queue, ...(laterGreen === undefined ? {} : { laterGreen }) };
      }
      const later = (await green(`branch=${encodeURIComponent(pull.head.ref)}&event=${run.event}`, run.workflow))
        .filter((one) => Date.parse(one.created_at) > Date.parse(run.createdAt) && one.head_sha !== run.head)
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
      const laterGreen = later === undefined ? undefined : { head: later.head_sha, reaches: await reachesFrom(run.head, later.head_sha, own) };
      return { jobs, ...named, reach, passedSameHead, ...(laterGreen === undefined ? {} : { laterGreen }) };
    },
  };
}

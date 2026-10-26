/**
 * Capability 8 · Harbor task adapter (ADR-1064 D7): Harbor in, Harbor's verifier out. A Harbor task is a folder holding
 * `task.toml`, `instruction.md`, `environment/` (the task image's Dockerfile and build context) and `tests/` (the hidden
 * tests, run by `tests/test.sh` inside that image, which leaves its results under `/logs/verifier`).
 *
 * Importing one for an experiment makes three things. The experiment's private tests repository, `x-<experiment>-tests`,
 * holds `environment/`, `tests/` and the counting script, and is the only place the tests are pushed. Each arm's public
 * repository (capability 3) is seeded from the task's starting tree, with a `.storytree.json` naming the arm's project,
 * and its CI's verifier builds the task image from the tests repository, runs `tests/test.sh` against the merged tree and
 * reports passed and total. Each arm's throwaway library (capability 2) gets the instruction as its one arc.
 *
 * Every GitHub step goes through `gh` and every arc through `park`, both injectable, so the tests watch the calls.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveKey } from "@storytree/keys";
import { connect } from "@storytree/library";
import { readExperiment, readLibrary } from "@storytree/project-and-caller";

import { armRepositoryName, ghCli, makeArmRepository, ORGANISATION, type ArmCi, type Gh } from "../repositories.js";
import { armWorkspace } from "../workspaces.js";

/** A Harbor task, as the adapter reads it. */
export interface HarborTask {
  /** `[task] name` in task.toml, or the folder's name. */
  readonly name: string;
  readonly instruction: string;
  readonly environment: string;
  readonly tests: string;
  /** `[verifier]` in task.toml: its time limit, whether it may reach the network, and the environment it adds. */
  readonly verifier: { readonly timeoutSec?: number; readonly network: boolean; readonly env: Readonly<Record<string, string>> };
}

/** The keys of task.toml the adapter reads, by table: a string or a number each. Arrays and inline tables are skipped. */
function readToml(text: string): Record<string, Record<string, string | number>> {
  const tables: Record<string, Record<string, string | number>> = { "": {} };
  let table = tables[""]!;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (header !== null) {
      table = tables[header[1]!] ??= {};
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([-+]?[0-9][0-9_]*(?:\.[0-9]+)?))\s*(?:#.*)?$/.exec(line);
    if (pair === null) continue;
    table[pair[1]!] = pair[2] !== undefined ? JSON.parse(`"${pair[2]}"`) as string : Number(pair[3]!.replaceAll("_", ""));
  }
  return tables;
}

/** Read the Harbor task in `dir`; refused, naming what is missing, when it is not one. */
export function readHarborTask(dir: string): HarborTask {
  const folder = path.resolve(dir);
  const missing = ["task.toml", "instruction.md", "environment/Dockerfile", "tests/test.sh"].filter((part) => !existsSync(path.join(folder, part)));
  if (missing.length > 0) throw new Error(`${folder} is not a Harbor task: it has no ${missing.join(", ")}.`);
  const toml = readToml(readFileSync(path.join(folder, "task.toml"), "utf8"));
  const verifier = toml.verifier ?? {};
  const env = Object.fromEntries(Object.entries(toml["verifier.env"] ?? {}).map(([key, value]) => [key, String(value)]));
  return {
    name: typeof toml.task?.name === "string" ? toml.task.name : path.basename(folder),
    instruction: readFileSync(path.join(folder, "instruction.md"), "utf8"),
    environment: path.join(folder, "environment"),
    tests: path.join(folder, "tests"),
    verifier: {
      ...(typeof verifier.timeout_sec === "number" ? { timeoutSec: Math.ceil(verifier.timeout_sec) } : {}),
      network: verifier.network_mode !== "no-network",
      env,
    },
  };
}

/** The experiment's private tests repository's name, `x-<experiment>-tests`. */
export function testsRepositoryName(experiment: string): string {
  return armRepositoryName(experiment, "tests");
}

/** Where the counting script sits in the tests repository. */
export const COUNTS_SCRIPT = "counts.mjs";

/** Where the task's number of hidden tests sits beside the counting script, when the import was given it: `{"total": n}`. */
export const TOTAL_FILE = "total.json";

/**
 * Reads the results a Harbor verifier left in `/logs/verifier` (the folder given) and prints `{"passed": n, "total": m}`;
 * exits 1 with nothing printed when it left none. A CTRF report counts its tests; a metrics.json counts its `passed` and
 * `total` fields, or the sums of its `<kind>_passed` and `<kind>_total`; a reward alone is one test, passed when it is 1.
 * A metrics.json whose totals are all 0 says the verifier stopped before its tests (a build that failed): that is none of
 * the task's tests passed, out of the total in total.json beside the script, or no result when the import was given none.
 */
export const COUNTS_SOURCE = `import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const folder = process.argv[2];
const taskTotal = (() => {
  try { return JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "${TOTAL_FILE}"), "utf8")).total; } catch { return undefined; }
})();
const read = (name) => {
  const file = path.join(folder, name);
  if (!existsSync(file)) return undefined;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
};
const sum = (metrics, suffix) => Object.entries(metrics)
  .filter(([key, value]) => (key === suffix || key.endsWith("_" + suffix)) && typeof value === "number")
  .reduce((total, [, value]) => total + value, 0);

let counts;
const summary = read("ctrf.json")?.results?.summary;
const metrics = read("metrics.json");
if (typeof summary?.tests === "number") counts = { passed: Number(summary.passed ?? 0), total: summary.tests };
else if (metrics !== undefined && sum(metrics, "total") > 0) counts = { passed: sum(metrics, "passed"), total: sum(metrics, "total") };
else if (metrics !== undefined && Object.keys(metrics).some((key) => key === "total" || key.endsWith("_total"))) {
  if (typeof taskTotal === "number") counts = { passed: 0, total: taskTotal };
} else {
  const reward = existsSync(path.join(folder, "reward.txt")) ? Number(readFileSync(path.join(folder, "reward.txt"), "utf8").trim()) : read("reward.json")?.reward;
  if (typeof reward === "number" && !Number.isNaN(reward)) counts = { passed: reward >= 1 ? 1 : 0, total: 1 };
}
if (counts === undefined) process.exit(1);
console.log(JSON.stringify(counts));
`;

/** Quotes a word for a POSIX shell. */
function quote(word: string): string {
  return /^[A-Za-z0-9_./:=-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * The verifier's shell command, as an arm's CI runs it (capability 3's `ArmCi`): it builds the task image from the tests
 * repository's `environment/`, runs `tests/test.sh` in it with the merged tree at `workdir`, under the task's time limit,
 * network rule and environment, and counts what it left in `/logs/verifier` into `$VERIFIER_RESULT`.
 */
export function verifierCommand(task: HarborTask, workdir = "/app"): string {
  const logs = `"$RUNNER_TEMP/harbor-logs"`;
  const run = [
    ...(task.verifier.timeoutSec === undefined ? [] : ["timeout", `${task.verifier.timeoutSec}s`]),
    "docker", "run", "--rm",
    ...(task.verifier.network ? [] : ["--network", "none"]),
    ...Object.entries(task.verifier.env).flatMap(([key, value]) => ["-e", quote(`${key}=${value}`)]),
    "-v", `"$GITHUB_WORKSPACE:${workdir}"`, "-v", `"$HIDDEN_TESTS/tests:/tests:ro"`, "-v", `${logs}:/logs`,
    "storytree-harbor-task", "bash", "/tests/test.sh",
  ];
  return [
    `mkdir -p ${logs}/verifier`,
    `docker build -q -t storytree-harbor-task "$HIDDEN_TESTS/environment" && ${run.join(" ")}`,
    `node "$HIDDEN_TESTS/${COUNTS_SCRIPT}" ${logs}/verifier > "$VERIFIER_RESULT"`,
  ].join("; ");
}

/** The arm's own checks when none is given: the script its lanes keep at `ci/checks.sh`, passing until they write it. */
export const ARM_CHECKS = `if [ -f ci/checks.sh ]; then bash ci/checks.sh; else echo "No ci/checks.sh yet: the arm's lanes write the checks every pull request must pass."; fi`;

/** Makes a folder for one commit's seed, runs `body` on it, and removes it. */
function withSeed<T>(body: (seed: string) => T): T {
  const seed = mkdtempSync(path.join(tmpdir(), "storytree-harbor-seed-"));
  try {
    return body(seed);
  } finally {
    rmSync(seed, { recursive: true, force: true });
  }
}

/**
 * Makes the experiment's private tests repository from the task, and returns its full name. Only it is given the tests.
 * `total`, the task's number of hidden tests when it is known, is written beside the counting script.
 */
export function makeTestsRepository(experiment: string, task: HarborTask, gh: Gh = ghCli, total?: number): string {
  const repository = `${ORGANISATION}/${testsRepositoryName(experiment)}`;
  withSeed((seed) => {
    cpSync(task.environment, path.join(seed, "environment"), { recursive: true });
    cpSync(task.tests, path.join(seed, "tests"), { recursive: true });
    writeFileSync(path.join(seed, COUNTS_SCRIPT), COUNTS_SOURCE);
    if (total !== undefined) writeFileSync(path.join(seed, TOTAL_FILE), `${JSON.stringify({ total })}\n`);
    git(seed, ["init", "-q", "-b", "main"]);
    git(seed, ["add", "-A"]);
    git(seed, ["commit", "-q", "-m", `The hidden tests of Harbor task ${task.name}`]);
    gh(["repo", "create", repository, "--private", "--source", seed, "--push", "--description", `Experiment ${experiment}: the hidden tests of Harbor task ${task.name}, never shown to an arm (ADR-1064 D7)`]);
  });
  return repository;
}

function git(cwd: string, args: readonly string[]): void {
  const run = spawnSync("git", ["-c", "user.name=storytree experiments", "-c", "user.email=experiments@storytree.invalid", ...args], { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.error?.message ?? run.stderr.trim()}`);
}

/** The arc each arm's library is given: the task's instruction is its intent. */
export interface TaskArc {
  readonly title: string;
  readonly intent: string;
  readonly endState: string;
}

/** Parks `arc` in the throwaway library the arm home `home` points at; refused when that library has an arc already. */
export type Park = (home: string, project: string, arc: TaskArc) => Promise<string>;

/** Opens the arm's own library, as its home's settings and key say, and parks the arc there as its one arc. */
export const parkInArmLibrary: Park = async (home, project, arc) => {
  const setting = readLibrary(home);
  if (setting.location !== "postgres") throw new Error(`The arm home ${home} names no Postgres library: make the arm with \`storytree experiment arm make\` first.`);
  const password = resolveKey("postgres", { home, env: {} });
  if (password === undefined) throw new Error(`The arm home ${home} holds no postgres key: make the arm again.`);
  const signedIn = new URL(setting.address);
  signedIn.password = password;
  const storytree = await connect({ url: signedIn.href });
  try {
    const library = await storytree.openProject(project);
    try {
      const arcs = await library.arcViews();
      if (arcs.length > 0) throw new Error(`The arm's library ${project} has an arc already (${arcs.map((view) => view.arc.id).join(", ")}): a task is imported into a fresh arm only.`);
      return (await library.createArc(arc, { actor: "storytree experiment task import" })).id;
    } finally {
      await library.close();
    }
  } finally {
    await storytree.close();
  }
};

/** What `importHarborTask` is given. */
export interface TaskImport {
  readonly task: string;
  readonly experiment: string;
  /** Each arm, with its storytree home, as `storytree experiment arm make` made it. */
  readonly arms: readonly { readonly arm: string; readonly home: string }[];
  readonly secrets: { readonly testsToken: string; readonly mergeQueueToken: string };
  /** The arm's own checks; `ARM_CHECKS` by default. */
  readonly checks?: string;
  /** The folder the arms start from; the task's `environment/` without its Dockerfile by default. */
  readonly startingTree?: string;
  /** Where the merged tree sits in the task image when the verifier runs; `/app`, Harbor's convention, by default. */
  readonly workdir?: string;
  /** The task's number of hidden tests, the total a run that stops before its tests is counted out of; none by default. */
  readonly total?: number;
}

/** What an import made. */
export interface ImportedTask {
  readonly task: string;
  readonly testsRepository: string;
  readonly arms: readonly { readonly arm: string; readonly repository: string; readonly arc: string }[];
}

/**
 * Imports the Harbor task for the experiment: checks every arm's home first, then makes the tests repository, each arm's
 * repository and each arm's arc. An arm whose home is missing or names another arm refuses the import before anything is made.
 */
export async function importHarborTask(spec: TaskImport, seams: { readonly gh?: Gh; readonly park?: Park } = {}): Promise<ImportedTask> {
  const gh = seams.gh ?? ghCli;
  const park = seams.park ?? parkInArmLibrary;
  const task = readHarborTask(spec.task);
  if (spec.arms.length === 0) throw new Error("Name at least one arm to import the task into.");
  const arms = spec.arms.map(({ arm, home }) => {
    const workspace = armWorkspace(spec.experiment, arm, home);
    const named = readExperiment(workspace.home);
    if (named?.name !== spec.experiment || named.arm !== arm) {
      throw new Error(`${workspace.home} is not the home of arm "${arm}" of experiment "${spec.experiment}": make it with \`storytree experiment arm make ${spec.experiment} ${arm}\` first. Nothing was made.`);
    }
    return workspace;
  });

  if (spec.total !== undefined && !(Number.isInteger(spec.total) && spec.total > 0)) throw new Error(`The task's total of hidden tests must be a whole number above 0, not ${spec.total}. Nothing was made.`);
  const testsRepository = makeTestsRepository(spec.experiment, task, gh, spec.total);
  const ci: ArmCi = { checks: spec.checks ?? ARM_CHECKS, verifier: { testsRepository, command: verifierCommand(task, spec.workdir) } };
  const arc: TaskArc = {
    title: `Harbor task ${task.name}`,
    intent: task.instruction,
    endState: "Every hidden test passes on main: the verifier's count after a merge reads passed equal to total.",
  };
  const made: { arm: string; repository: string; arc: string }[] = [];
  for (const workspace of arms) {
    const arm = workspace.role.slice(`x-${spec.experiment}-`.length);
    const repository = withSeed((seed) => {
      if (spec.startingTree === undefined) {
        cpSync(task.environment, seed, { recursive: true, filter: (source) => path.relative(task.environment, source) !== "Dockerfile" });
      } else {
        cpSync(spec.startingTree, seed, { recursive: true });
      }
      writeFileSync(path.join(seed, ".storytree.json"), `${JSON.stringify({ project: workspace.project })}\n`);
      return makeArmRepository({ experiment: spec.experiment, arm, startingTree: seed, ci, secrets: spec.secrets }, gh);
    });
    made.push({ arm, repository, arc: await park(workspace.home, workspace.project, arc) });
  }
  return { task: task.name, testsRepository, arms: made };
}

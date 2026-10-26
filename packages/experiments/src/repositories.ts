/**
 * Capability 3 · Arm repositories (ADR-1064 D3, as the owner amended it 2026-10-16). Each arm builds in its own public,
 * throwaway repository in the storytree-ai organisation, so its pull requests, merge queue and conflicts behave as in the
 * real factory: seeded from the task's starting tree, with CI on Linux only and the merge queue on, and archived, never
 * deleted, when the experiment ends.
 *
 * The task's hidden tests are never committed: on each merge to main, CI fetches them from a private repository with a
 * token held as a secret of the `hidden-tests` environment, which only main may use, so neither a lane nor a pull
 * request's run can read it. The repository and its logs are public, so the verifier reports its counts and nothing else.
 * The workflow defines that job, so a change to it merged to main would run with the token and could print which tests
 * fail: everything under `.github` is owned, in the seed's CODEOWNERS, by the identity that makes the repository, which
 * the arms' lanes act as, and main requires a code owner's review, so no lane can approve such a change itself. (Branch
 * rules that refuse a path outright need a paid plan, and storytree-ai's is free.) A lane holding that identity's token
 * could still lift the rule by hand; the per-merge points (capability 5) compare the workflow with `armWorkflowText`.
 *
 * Every GitHub step goes through `gh`, injectable so the tests watch the calls instead of making repositories.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** The organisation every arm's repository is made in. */
export const ORGANISATION = "storytree-ai";
/** Where the arm's CI is written in its repository. JSON is YAML, so the workflow is written as JSON. */
export const ARM_WORKFLOW_PATH = ".github/workflows/arm.yml";
/** The seed's CODEOWNERS, giving everything under `.github` to the identity that made the repository. */
export const ARM_CODEOWNERS_PATH = ".github/CODEOWNERS";
/** The environment holding the hidden tests' token, usable from main alone. */
export const HIDDEN_TESTS_ENVIRONMENT = "hidden-tests";

/** Runs `gh` with `args`, `input` on its stdin, and returns its stdout; throws when it fails. */
export type Gh = (args: readonly string[], input?: string) => string;

/** What an arm's CI runs: the arm's own checks, which gate merging, and the task's verifier over its hidden tests. */
export interface ArmCi {
  /** The shell command for the checks every pull request and merge-queue entry must pass, kept by the arm's lanes. */
  readonly checks: string;
  readonly verifier: {
    /** The private repository the hidden tests are fetched from, `owner/name`. */
    readonly testsRepository: string;
    /**
     * The shell command that runs the hidden tests (found at `$HIDDEN_TESTS`) against the checked-out tree and writes
     * `{"passed": n, "total": m}` to `$VERIFIER_RESULT`. Its output is discarded, so no test's name reaches the public log.
     */
    readonly command: string;
  };
}

/** One arm's repository, as `makeArmRepository` makes it. */
export interface ArmRepositorySpec {
  readonly experiment: string;
  readonly arm: string;
  /** The folder holding the task's starting tree; copied, never changed. */
  readonly startingTree: string;
  readonly ci: ArmCi;
  readonly secrets: {
    /** Reads `ci.verifier.testsRepository`; held by the `hidden-tests` environment, never by a lane. */
    readonly testsToken: string;
    /** Enqueues a green pull request; a workflow's own token cannot, since GitHub starts no run from what that token does. */
    readonly mergeQueueToken: string;
  };
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The arm's repository's name, `x-<experiment>-<arm>`, the name its throwaway library takes too; malformed names are refused. */
export function armRepositoryName(experiment: string, arm: string): string {
  for (const [what, name] of [["experiment", experiment], ["arm", arm]] as const) {
    if (!SLUG.test(name)) throw new Error(`The ${what} name "${name}" cannot name a repository: use lowercase letters, digits and single hyphens.`);
  }
  return `x-${experiment}-${arm}`;
}

/** Prints the verifier's counts and nothing else; run by `node -e` in the workflow, the verifier's own output discarded. */
const REPORT_COUNTS = [
  `const { spawnSync } = require("node:child_process");`,
  `const fs = require("node:fs");`,
  `const run = spawnSync(process.env.VERIFIER_COMMAND, { shell: true, stdio: "ignore" });`,
  `let line;`,
  `try {`,
  `  const result = JSON.parse(fs.readFileSync(process.env.VERIFIER_RESULT, "utf8"));`,
  `  line = "passed=" + Number(result.passed) + " total=" + Number(result.total);`,
  `} catch {`,
  `  line = "The verifier wrote no result (exit " + run.status + ").";`,
  `  process.exitCode = 1;`,
  `}`,
  `console.log(line);`,
  `if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, line + "\\n");`,
].join("\n");

/** The arm's CI as a GitHub Actions workflow. */
export function armWorkflow(ci: ArmCi): Record<string, unknown> {
  return {
    name: "arm",
    on: { pull_request: { branches: ["main"] }, merge_group: {}, push: { branches: ["main"] } },
    permissions: { contents: "read" },
    jobs: {
      // The check the merge queue requires, on every pull request and on each queue entry.
      verify: {
        name: "verify",
        if: "github.event_name != 'push'",
        "runs-on": "ubuntu-latest",
        steps: [{ uses: "actions/checkout@v4" }, { name: "The arm's checks", run: ci.checks }],
      },
      // Hands a green pull request to the merge queue, as the real factory's `automerge` does.
      automerge: {
        name: "automerge",
        needs: "verify",
        if: "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository",
        "runs-on": "ubuntu-latest",
        steps: [{
          name: "Enqueue",
          env: {
            GH_TOKEN: "${{ secrets.MERGE_QUEUE_TOKEN }}",
            PR: "${{ github.event.pull_request.number }}",
            SHA: "${{ github.event.pull_request.head.sha }}",
          },
          run: `gh pr merge "$PR" --repo "$GITHUB_REPOSITORY" --auto --match-head-commit "$SHA"`,
        }],
      },
      // One run per merge to main: the experiment's measure, which never gates merging.
      "hidden-tests": {
        name: "hidden-tests",
        if: "github.event_name == 'push'",
        environment: HIDDEN_TESTS_ENVIRONMENT,
        "runs-on": "ubuntu-latest",
        steps: [
          { uses: "actions/checkout@v4" },
          {
            name: "Fetch the hidden tests",
            uses: "actions/checkout@v4",
            with: { repository: ci.verifier.testsRepository, token: "${{ secrets.EXPERIMENT_TESTS_TOKEN }}", path: ".hidden-tests" },
          },
          // The checkout can only land in the workspace, which the verifier mounts into the container the arm's code runs
          // in; out of it, that code can neither read the tests nor rewrite the script that counts their results.
          { name: "Move the hidden tests out of the workspace", run: `mv .hidden-tests "$RUNNER_TEMP/hidden-tests"` },
          {
            name: "Run the verifier",
            env: {
              VERIFIER_COMMAND: ci.verifier.command,
              HIDDEN_TESTS: "${{ runner.temp }}/hidden-tests",
              VERIFIER_RESULT: "${{ runner.temp }}/verifier-result.json",
              REPORT_COUNTS,
            },
            run: `node -e "$REPORT_COUNTS"`,
          },
        ],
      },
    },
  };
}

/** The workflow file's text, as the repository is seeded with it. */
export function armWorkflowText(ci: ArmCi): string {
  return `${JSON.stringify(armWorkflow(ci), null, 2)}\n`;
}

/** `gh` itself, under this process's sign-in. */
export const ghCli: Gh = (args, input) => {
  const run = spawnSync("gh", args, { input, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`gh ${args.join(" ")} failed: ${run.error?.message ?? run.stderr.trim()}`);
  return run.stdout;
};

function git(cwd: string, args: readonly string[]): void {
  const run = spawnSync("git", ["-c", "user.name=storytree experiments", "-c", "user.email=experiments@storytree.invalid", ...args], { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.error?.message ?? run.stderr.trim()}`);
}

/**
 * Makes one arm's repository and returns its full name: public in storytree-ai, its main seeded from the starting tree
 * plus the arm's CI and its CODEOWNERS in one commit, its secrets set, and main behind the merge queue, `verify` and a
 * code owner's review of any change under `.github`.
 */
export function makeArmRepository(spec: ArmRepositorySpec, gh: Gh = ghCli): string {
  const repository = `${ORGANISATION}/${armRepositoryName(spec.experiment, spec.arm)}`;
  const owner = gh(["api", "user", "--jq", ".login"]).trim();
  if (owner === "") throw new Error(`No GitHub login to be ${repository}'s code owner: sign gh in as the identity the arms' lanes act as.`);
  const seed = mkdtempSync(path.join(tmpdir(), "storytree-arm-seed-"));
  try {
    cpSync(spec.startingTree, seed, { recursive: true, filter: (source) => path.basename(source) !== ".git" });
    mkdirSync(path.join(seed, path.dirname(ARM_WORKFLOW_PATH)), { recursive: true });
    writeFileSync(path.join(seed, ARM_WORKFLOW_PATH), armWorkflowText(spec.ci));
    writeFileSync(path.join(seed, ARM_CODEOWNERS_PATH), `/.github/ @${owner}\n`);
    git(seed, ["init", "-q", "-b", "main"]);
    git(seed, ["add", "-A"]);
    git(seed, ["commit", "-q", "-m", `Seed ${repository} from the task's starting tree`]);
    gh(["repo", "create", repository, "--public", "--source", seed, "--push", "--description", `Experiment ${spec.experiment}, arm ${spec.arm}: a throwaway repository (ADR-1064)`]);
  } finally {
    rmSync(seed, { recursive: true, force: true });
  }
  gh(["repo", "edit", repository, "--enable-auto-merge", "--delete-branch-on-merge"]);

  const environment = `repos/${repository}/environments/${HIDDEN_TESTS_ENVIRONMENT}`;
  gh(["api", "-X", "PUT", environment, "--input", "-"], JSON.stringify({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } }));
  gh(["api", "-X", "POST", `${environment}/deployment-branch-policies`, "--input", "-"], JSON.stringify({ name: "main", type: "branch" }));
  gh(["secret", "set", "EXPERIMENT_TESTS_TOKEN", "--repo", repository, "--env", HIDDEN_TESTS_ENVIRONMENT], spec.secrets.testsToken);
  gh(["secret", "set", "MERGE_QUEUE_TOKEN", "--repo", repository], spec.secrets.mergeQueueToken);

  gh(["api", "-X", "POST", `repos/${repository}/rulesets`, "--input", "-"], JSON.stringify({
    name: "main",
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "pull_request", parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: true, require_last_push_approval: false, required_review_thread_resolution: false } },
      { type: "required_status_checks", parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: "verify" }] } },
      { type: "merge_queue", parameters: { merge_method: "MERGE", grouping_strategy: "ALLGREEN", max_entries_to_build: 5, max_entries_to_merge: 5, min_entries_to_merge: 1, min_entries_to_merge_wait_minutes: 1, check_response_timeout_minutes: 60 } },
    ],
  }));
  return repository;
}

/** Archives each arm's repository at the experiment's end, and returns their full names. */
export function archiveArmRepositories(experiment: string, arms: readonly string[], gh: Gh = ghCli): string[] {
  const repositories = arms.map((arm) => `${ORGANISATION}/${armRepositoryName(experiment, arm)}`);
  for (const repository of repositories) gh(["repo", "archive", repository, "--yes"]);
  return repositories;
}

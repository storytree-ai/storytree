/**
 * Capability 11 · Pipeline wiring (the agent link story, ADR-0911 D1, D3): storytree's pipeline for a user's
 * project, which the agent connects at setup and never writes for itself. It runs the project's own install
 * and test commands, and `storytree check` from storytree's public source at this storytree's release, with
 * only the Guardrails package installed (packages/guardrails/src/check/run.ts). On GitHub it is a workflow
 * file; elsewhere, the same commands for the pipeline the user has. Branch protection, merging only what CI
 * verified, is a repository setting: it is proposed for the user to approve, never applied here.
 */
import { execFileSync } from "node:child_process";

/** The release stamped into a bundled build, as JSON; undeclared when run from source. */
declare const STORYTREE_RELEASE: string | undefined;

/** The systems a user's tests can run on, each with GitHub's runner for it. */
export const SYSTEMS = { linux: "ubuntu-latest", macos: "macos-latest", windows: "windows-latest" } as const;
export type System = keyof typeof SYSTEMS;

/** Where storytree's workflow is written in a GitHub project. */
export const WORKFLOW_FILE = ".github/workflows/storytree.yml";

/** The workflow job, and so the status check, that runs storytree check. */
const CHECK_JOB = "storytree check";

/** The storytree source a user's pipeline checks out: this build's release tag, or main when run from source. */
export function storytreeRef(): string {
  return typeof STORYTREE_RELEASE === "string" ? `v${(JSON.parse(STORYTREE_RELEASE) as { version: string }).version}` : "main";
}

/** The shell lines that run storytree check on the checkout at `$workspace`, from storytree's source at `ref`. */
export function checkCommands(ref: string, workspace: string): string[] {
  return [
    `git clone --quiet --depth 1 --branch ${ref} https://github.com/storytree-ai/storytree.git "$RUNNER_TEMP/storytree"`,
    `cd "$RUNNER_TEMP/storytree"`,
    "corepack enable",
    `pnpm install --frozen-lockfile --filter "@storytree/guardrails..."`,
    "cd packages/guardrails",
    `node --import tsx src/check/run.ts "${workspace}"`,
  ];
}

/** The GitHub repository `folder`'s origin names, as owner and name; undefined when its origin is not on GitHub. */
export function githubRepository(folder: string): { owner: string; name: string } | undefined {
  let url: string;
  try {
    url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
  } catch {
    return undefined;
  }
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(url);
  return match === null ? undefined : { owner: match[1]!, name: match[2]! };
}

/** storytree's workflow for a GitHub project: the project's tests on each system, and storytree check. */
export function workflowFor({ install, test, systems, ref }: { install?: string | undefined; test: string; systems: readonly System[]; ref: string }): string {
  const runs = [...(install === undefined ? [] : [install]), test].map((command) => `      - run: ${JSON.stringify(command)}`);
  return [
    "# storytree's pipeline (ADR-0911): the project's tests and storytree check on every pull request.",
    "# storytree provides this file through its agent's wire_pipeline: change the commands, never the checks.",
    "name: storytree",
    "on:",
    "  pull_request:",
    "  push:",
    "    branches: [main]",
    "jobs:",
    "  test:",
    "    strategy:",
    "      matrix:",
    `        os: [${systems.map((system) => SYSTEMS[system]).join(", ")}]`,
    "    runs-on: ${{ matrix.os }}",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 24",
    ...runs,
    "  storytree-check:",
    `    name: ${CHECK_JOB}`,
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 24",
    "      - name: storytree check",
    "        run: |",
    ...checkCommands(ref, "$GITHUB_WORKSPACE").map((line) => `          ${line}`),
    "",
  ].join("\n");
}

/** The branch protection to propose for `repository`: merge to main only what every check above verified. */
export function protectionCommand(repository: { owner: string; name: string }, systems: readonly System[]): string {
  const body = { required_status_checks: { strict: true, contexts: [...systems.map((system) => `test (${SYSTEMS[system]})`), CHECK_JOB] }, enforce_admins: false, required_pull_request_reviews: null, restrictions: null };
  return `gh api -X PUT repos/${repository.owner}/${repository.name}/branches/main/protection --input - <<'JSON'\n${JSON.stringify(body)}\nJSON`;
}

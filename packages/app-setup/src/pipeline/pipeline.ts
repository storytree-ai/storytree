/**
 * Capability 11 · Pipeline wiring (the app setup story since ADR-0969 D3; ADR-0911 D1, D3): storytree's pipeline for a user's
 * project, which the agent connects at setup and never writes for itself. It runs the project's own install
 * and test commands, and each job the parts the host mounts contribute through their manifests' `pipelineJobs`
 * (Guardrails' `storytree check`, ADR-1170 D2), at this storytree's release: a part switched off contributes none.
 * On GitHub it is a workflow file; elsewhere, the same commands for the pipeline the user has. Branch protection,
 * merging only what CI verified, is a repository setting: it is proposed for the user to approve, never applied here.
 *
 * A project that imports existing code (ADR-0993 D1) has its tests stand on that code, so the pipeline fetches
 * each imported folder first, from its recorded repository at its recorded commit, into the place beside the
 * checkout where the folder sits (where a `link:` or `file:` dependency names it), and installs its own
 * dependencies, which a built package borrows. The commit moves only when the folder is imported again.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { Storytree } from "@storytree/library";
import { ask, type Answer } from "@storytree/session-management";
import { importsOf, machineOf, storytreeHome } from "@storytree/project-and-caller";

/** The release stamped into a bundled build, as JSON; undeclared when run from source. */
declare const STORYTREE_RELEASE: string | undefined;

/** The systems a user's tests can run on, each with GitHub's runner for it. */
export const SYSTEMS = { linux: "ubuntu-latest", macos: "macos-latest", windows: "windows-latest" } as const;
export type System = keyof typeof SYSTEMS;

/** Where storytree's workflow is written in a GitHub project. */
export const WORKFLOW_FILE = ".github/workflows/storytree.yml";

/**
 * A job a part contributes to a user's pipeline, as its manifest's `pipelineJobs` names it: its name is the workflow
 * job's and so the status check's, and its commands run on the checkout at `workspace`, from storytree's source at `ref`.
 */
export interface PipelineJob {
  readonly name: string;
  /** Whether it needs the checkout's whole history, with origin/main, rather than the change alone. */
  readonly needsHistory?: boolean;
  commands(ref: string, workspace: string): readonly string[];
}

/** This build's stamped release, with the full commit it was built from; undefined when run from source. */
const STAMPED = typeof STORYTREE_RELEASE === "string" ? (JSON.parse(STORYTREE_RELEASE) as { version: string; commit: string }) : undefined;

/** The storytree source a user's pipeline checks out: the full commit `release` was built from, or main when run from source. */
export function storytreeRef(release: { version: string; commit: string } | undefined = STAMPED): string {
  return release?.commit ?? "main";
}

/** The actions storytree's workflow uses, each pinned to a commit (the release it is, after the #). */
const CHECKOUT = "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0";
const SETUP_NODE = "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0";

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

/** One folder a project imports, as its pipeline can fetch it, or why it cannot. */
export type ImportFetch =
  | { readonly folder: string; readonly repository: string; readonly commit: string; readonly commands: readonly string[] }
  | { readonly folder: string; readonly unfetchable: string };

/**
 * What the pipeline fetches for each folder `project` imports on this machine (as recorded in `home`), from
 * the checkout at `folder`: the commands that clone it at its recorded commit into its place relative to the
 * checkout's top, and install its own dependencies by its lockfile; or, with no repository or commit recorded,
 * or no place relative to the checkout, why CI cannot fetch it.
 */
export async function importFetches({ storytree, project, folder, home = storytreeHome() }: { storytree: Storytree; project: string; folder: string; home?: string }): Promise<ImportFetch[]> {
  const imports = await importsOf(storytree, project, machineOf(home).id);
  if (imports.length === 0) return [];
  const top = checkoutTop(folder);
  return imports.map(({ folder: imported, repository, commit }) => {
    if (repository === undefined) return { folder: imported, unfetchable: "it was imported from a folder with no git remote, so it has no address CI can clone" };
    if (commit === undefined) return { folder: imported, unfetchable: "it was imported with no commit checked out, so there is no commit to fetch" };
    const place = path.relative(top, imported);
    if (path.isAbsolute(place)) return { folder: imported, unfetchable: "it is on another drive from this checkout, so it has no place beside CI's checkout" };
    const at = JSON.stringify(place.split(path.sep).join("/"));
    const url = cloneable(repository);
    return { folder: imported, repository: url, commit, commands: [`git clone --quiet --no-checkout ${url} ${at}`, `git -C ${at} checkout --quiet ${commit}`, ...installCommands(imported, at)] };
  });
}

/** The top of the git checkout `folder` is in, where CI's checkout starts; the folder itself when it is in none. */
function checkoutTop(folder: string): string {
  try {
    return path.resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim());
  } catch {
    return folder;
  }
}

/** A GitHub SSH address as the HTTPS one CI can clone without a key; any other address as it is. */
function cloneable(repository: string): string {
  const ssh = /^git@github\.com:(.+)$/.exec(repository);
  return ssh === null ? repository : `https://github.com/${ssh[1]}`;
}

/** The commands that install the dependencies of the folder fetched to `at`, by the lockfile `imported` holds. */
function installCommands(imported: string, at: string): string[] {
  const has = (file: string): boolean => existsSync(path.join(imported, file));
  if (has("pnpm-lock.yaml")) return ["corepack enable", `pnpm --dir ${at} install --frozen-lockfile`];
  if (has("yarn.lock")) return ["corepack enable", `yarn --cwd ${at} install --frozen-lockfile`];
  if (has("package-lock.json")) return [`npm ci --prefix ${at}`];
  return [`npm install --prefix ${at}`];
}

/** storytree's workflow for a GitHub project: the project's tests on each system, after fetching what it imports, and each contributed job. */
export function workflowFor({ install, test, systems, ref, fetches = [], jobs }: { install?: string | undefined; test: string; systems: readonly System[]; ref: string; fetches?: readonly string[]; jobs: readonly PipelineJob[] }): string {
  const runs = [...fetches, ...(install === undefined ? [] : [install]), test].map((command) => `      - run: ${JSON.stringify(command)}`);
  return [
    "# storytree's pipeline (ADR-0911): the project's tests, and the checks storytree's parts contribute, on every pull request.",
    "# storytree provides this file through its agent's wire_pipeline: change the commands, never the checks.",
    "name: storytree",
    "on:",
    "  pull_request:",
    "  push:",
    "    branches: [main]",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  test:",
    "    strategy:",
    "      matrix:",
    `        os: [${systems.map((system) => SYSTEMS[system]).join(", ")}]`,
    "    runs-on: ${{ matrix.os }}",
    "    steps:",
    `      - uses: ${CHECKOUT}`,
    "        with:",
    "          persist-credentials: false",
    `      - uses: ${SETUP_NODE}`,
    "        with:",
    "          node-version: 24",
    ...runs,
    ...jobs.flatMap((job) => [
      `  ${job.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:`,
      `    name: ${job.name}`,
      "    runs-on: ubuntu-latest",
      "    steps:",
      `      - uses: ${CHECKOUT}`,
      "        with:",
      "          persist-credentials: false",
      ...(job.needsHistory === true ? ["          fetch-depth: 0"] : []),
      `      - uses: ${SETUP_NODE}`,
      "        with:",
      "          node-version: 24",
      `      - name: ${job.name}`,
      "        run: |",
      ...job.commands(ref, "$GITHUB_WORKSPACE").map((line) => `          ${line}`),
    ]),
    "",
  ].join("\n");
}

/** The branch protection to propose for `repository`: merge to main only what every check above verified. */
export function protectionCommand(repository: { owner: string; name: string }, systems: readonly System[], jobs: readonly PipelineJob[]): string {
  const body = { required_status_checks: { strict: true, contexts: [...systems.map((system) => `test (${SYSTEMS[system]})`), ...jobs.map((job) => job.name)] }, enforce_admins: false, required_pull_request_reviews: null, restrictions: null };
  return `gh api -X PUT repos/${repository.owner}/${repository.name}/branches/main/protection --input - <<'JSON'\n${JSON.stringify(body)}\nJSON`;
}

/** Whether GitHub lets `repository`'s plan protect a branch: read, never set. */
export type Protection = "allowed" | "refused by plan" | "unknown";
export type ProtectionReader = (folder: string, repository: { owner: string; name: string }) => Promise<Protection>;

/** How long gh may take to read a branch's protection. */
const GH_WAIT_MS = 10_000;

/** Reads `repository`'s main branch protection by asking `command` (gh, with `prefix` before its own arguments). */
export const protectionThrough = (command: string, prefix: readonly string[] = []): ProtectionReader => async (folder, repository) =>
  protectionFrom(await ask(command, [...prefix, "api", `repos/${repository.owner}/${repository.name}/branches/main/protection`], process.env, GH_WAIT_MS, { cwd: folder, shell: false }));

/** The protection read through `gh`: unknown when gh is missing, signed out, slow or says anything else. */
export const ghProtection: ProtectionReader = protectionThrough("gh");

/** What a protection read's answer says: gh prints GitHub's body, so a refusal names the plan and a 404 an unprotected branch. */
function protectionFrom(answer: Answer): Protection {
  if (!answer.answered) return "unknown";
  if (answer.code === 0) return "allowed";
  let body: { message?: unknown; status?: unknown };
  try {
    body = JSON.parse(answer.out) as typeof body;
  } catch {
    return "unknown";
  }
  const message = typeof body.message === "string" ? body.message : "";
  if (String(body.status) === "403" && /upgrade to github pro|make this repository public/i.test(message)) return "refused by plan";
  if (String(body.status) === "404" && /branch not protected/i.test(message)) return "allowed";
  return "unknown";
}

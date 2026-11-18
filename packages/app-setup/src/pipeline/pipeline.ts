// Capability 11 · Pipeline wiring.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { Storytree } from "@storytree/library";
import { ask, type Answer } from "@storytree/session-management";
import { importsOf, machineOf, storytreeHome } from "@storytree/project-and-caller";

declare const STORYTREE_RELEASE: string | undefined;

export const SYSTEMS = { linux: "ubuntu-latest", macos: "macos-latest", windows: "windows-latest" } as const;
export type System = keyof typeof SYSTEMS;

export const WORKFLOW_FILE = ".github/workflows/storytree.yml";

export interface PipelineJob {
  readonly name: string;
  readonly needsHistory?: boolean;
  commands(ref: string, workspace: string): readonly string[];
}

const STAMPED = typeof STORYTREE_RELEASE === "string" ? (JSON.parse(STORYTREE_RELEASE) as { version: string; commit: string }) : undefined;

export function storytreeRef(release: { version: string; commit: string } | undefined = STAMPED): string {
  return release?.commit ?? "main";
}

const CHECKOUT = "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6.1.0";
const SETUP_NODE = "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0";
const SETUP_PYTHON = "actions/setup-python@6d4fd22b20465ccc0f7354476588e8df7c9ca0e0 # v7.1.0";
const SETUP_UV = "astral-sh/setup-uv@68559e99cc807c1eb7e9238fd43a15bba460eec2 # v10.3.3";

const PYTHON_MANIFESTS = ["pyproject.toml", "setup.cfg", "setup.py"];

export type PythonSetup = "none" | "uv" | "poetry";
export function pythonSetupOf(folders: readonly string[]): PythonSetup {
  const has = (folder: string, file: string): boolean => existsSync(path.join(folder, file));
  const python = folders.filter((folder) => PYTHON_MANIFESTS.some((manifest) => has(folder, manifest)));
  if (python.length === 0) return "none";
  return python.some((folder) => has(folder, "poetry.lock")) ? "poetry" : "uv";
}

const INSTALL_POETRY = "pipx install poetry";

export function pythonCommands(python: PythonSetup): string[] {
  return python === "poetry" ? [INSTALL_POETRY] : [];
}

export function pytestWithoutSummary(test: string): boolean {
  return /\bpytest\b/.test(test) && !/(?:^|\s)-r[a-zA-Z]*A/.test(test);
}

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

export type ImportFetch =
  | { readonly folder: string; readonly repository: string; readonly commit: string; readonly commands: readonly string[] }
  | { readonly folder: string; readonly unfetchable: string };

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

function checkoutTop(folder: string): string {
  try {
    return path.resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim());
  } catch {
    return folder;
  }
}

function cloneable(repository: string): string {
  const ssh = /^git@github\.com:(.+)$/.exec(repository);
  return ssh === null ? repository : `https://github.com/${ssh[1]}`;
}

function installCommands(imported: string, at: string): string[] {
  const has = (file: string): boolean => existsSync(path.join(imported, file));
  if (has("pnpm-lock.yaml")) return ["corepack enable", `pnpm --dir ${at} install --frozen-lockfile`];
  if (has("yarn.lock")) return ["corepack enable", `yarn --cwd ${at} install --frozen-lockfile`];
  if (has("package-lock.json")) return [`npm ci --prefix ${at}`];
  if (has("uv.lock")) return [`uv sync --frozen --directory ${at}`];
  if (has("poetry.lock")) return [`poetry --directory ${at} install`];
  if (!has("package.json") && PYTHON_MANIFESTS.some(has)) return [`python -m pip install ${at}`];
  return [`npm install --prefix ${at}`];
}

export function workflowFor({ install, test, systems, ref, fetches = [], jobs, python = "none" }: { install?: string | undefined; test: string; systems: readonly System[]; ref: string; fetches?: readonly string[]; jobs: readonly PipelineJob[]; python?: PythonSetup }): string {
  const runs = [...pythonCommands(python), ...fetches, ...(install === undefined ? [] : [install]), test].map((command) => `      - run: ${JSON.stringify(command)}`);
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
    ...(python === "none" ? [] : [`      - uses: ${SETUP_PYTHON}`, "        with:", '          python-version: "3.x"', `      - uses: ${SETUP_UV}`]),
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

export function protectionCommand(repository: { owner: string; name: string }, systems: readonly System[], jobs: readonly PipelineJob[]): string {
  const body = { required_status_checks: { strict: true, contexts: [...systems.map((system) => `test (${SYSTEMS[system]})`), ...jobs.map((job) => job.name)] }, enforce_admins: false, required_pull_request_reviews: null, restrictions: null };
  return `gh api -X PUT repos/${repository.owner}/${repository.name}/branches/main/protection --input - <<'JSON'\n${JSON.stringify(body)}\nJSON`;
}

export type Protection = "allowed" | "refused by plan" | "unknown";
export type ProtectionReader = (folder: string, repository: { owner: string; name: string }) => Promise<Protection>;

const GH_WAIT_MS = 10_000;

export const protectionThrough = (command: string, prefix: readonly string[] = []): ProtectionReader => async (folder, repository) =>
  protectionFrom(await ask(command, [...prefix, "api", `repos/${repository.owner}/${repository.name}/branches/main/protection`], process.env, GH_WAIT_MS, { cwd: folder, shell: false }));

export const ghProtection: ProtectionReader = protectionThrough("gh");

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

// Capability 3 · Worktree setup
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { floorRefusal } from "./node-runtime.mjs";

if (process.platform === "win32") process.env.NoDefaultCurrentDirectoryInExePath ??= "1";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const WORKSPACE_GROUPS = ["packages", "apps"];

function runGit(root, args, timeout = 5_000) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function gitIn(root, args) {
  const result = runGit(root, args);
  return result.status === 0 ? result.stdout.trim() : "";
}

function superproject(root) {
  return gitIn(root, ["rev-parse", "--show-superproject-working-tree"]);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(gitDir, update, lockMs) {
  const lock = path.join(gitDir, "storytree-fast-forward.lock");
  for (let held = false; !held;) {
    try {
      mkdirSync(lock);
      held = true;
    } catch (error) {
      if (error.code !== "EEXIST") return update();
      let age;
      try {
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        continue;
      }
      if (age > lockMs) rmSync(lock, { recursive: true, force: true });
      else sleepSync(200);
    }
  }
  try {
    return update();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function updateCheckout(root, { fastForward = true, fetchMs = 20_000, lockMs = 120_000, log = () => {} } = {}) {
  const dirs = gitIn(root, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]).split(/\r?\n/);
  if (dirs.length !== 2 || dirs[0] !== dirs[1]) return "";
  if (superproject(root)) return "";
  if (gitIn(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]) !== "main") return "";
  const gap = () => {
    const counts = gitIn(root, ["rev-list", "--left-right", "--count", "HEAD...refs/remotes/origin/main"]);
    return /^\d+\s+\d+$/.test(counts) ? counts.split(/\s+/).map(Number) : undefined;
  };
  let why = "";
  if (fastForward) {
    withLock(dirs[0], () => {
      const fetched = runGit(root, ["fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main"], fetchMs);
      if (fetched.status !== 0) {
        why = ` Fetching origin failed or took over ${fetchMs / 1000} s, so it was not brought up to date.`;
        return;
      }
      const [ahead, behind] = gap() ?? [0, 0];
      if (behind === 0 || ahead > 0) return;
      if (gitIn(root, ["--no-optional-locks", "status", "--porcelain", "--untracked-files=no"]) !== "") {
        why = " It has local edits, so it was not brought up to date.";
        return;
      }
      if (runGit(root, ["merge", "--quiet", "--ff-only", "refs/remotes/origin/main"], 60_000).status !== 0) {
        why = " The fast-forward failed, so it was not brought up to date.";
        return;
      }
      log(`provision-worktree: primary checkout fast-forwarded ${behind} commit${behind === 1 ? "" : "s"} to origin/main`);
    }, lockMs);
  }
  const counts = gap();
  if (counts === undefined) return "";
  const [ahead, behind] = counts;
  if (behind === 0) return "";
  const reconcile = ahead > 0
    ? ` It has ${ahead} local commit${ahead === 1 ? "" : "s"}, so it was not brought up to date; reconcile those with origin/main before the fast-forward.`
    : why;
  return `storytree: the primary checkout (${root}) on main is ${behind} commit${behind === 1 ? "" : "s"} behind origin/main; ` +
    `the MCP server cannot start from this older code.${reconcile} Preserve any local edits, then run ` +
    "`git pull --ff-only origin main && pnpm install` in that checkout and restart the session's MCP server.";
}

function conditionOf(root) {
  const modules = path.join(root, "node_modules");
  if (!existsSync(path.join(modules, ".modules.yaml"))) return "fresh";
  if (unlinked(root)) return "unlinked";
  if (missingLink(root)) return "behind";
  if (lockfileAdvanced(root)) return "stale";
  return undefined;
}

function* workspacePackages(root) {
  for (const group of WORKSPACE_GROUPS) {
    let entries;
    try {
      entries = readdirSync(path.join(root, group), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, group, entry.name);
      try {
        yield { dir, manifest: JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) };
      } catch {
      }
    }
  }
}

function missingLink(root) {
  const packages = [...workspacePackages(root)];
  try {
    packages.unshift({ dir: root, manifest: JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) });
  } catch {
  }
  for (const { dir, manifest } of packages) {
    for (const field of ["dependencies", "devDependencies"]) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        if (typeof spec !== "string" || !spec.startsWith("workspace:")) continue;
        if (!existsSync(path.join(dir, "node_modules", name))) return `${manifest.name ?? path.basename(dir)} → ${name}`;
      }
    }
  }
  return undefined;
}

function lockfileAdvanced(root) {
  try {
    const wanted = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
    const installed = readFileSync(path.join(root, "node_modules", ".pnpm", "lock.yaml"), "utf8");
    const fold = (text) => text.replace(/\r\n/g, "\n");
    return fold(wanted) !== fold(installed);
  } catch {
    return false;
  }
}

function unlinked(root) {
  let packages = 0;
  for (const { dir } of workspacePackages(root)) {
    packages++;
    if (existsSync(path.join(dir, "node_modules"))) return false;
  }
  return packages > 0;
}

function cloudLibraryAddress(env) {
  return `wss://${encodeURIComponent(env.PGUSER || "storytree_library")}@library.storytree.dev/postgres`;
}

function inCloud(env) {
  return env.CLAUDE_CODE_REMOTE === "true";
}

export function cloudMain({ root = repoRoot, env = process.env, fetchMs = 20_000, log = () => {} } = {}) {
  if (!inCloud(env)) return { fetched: false };
  const result = runGit(root, ["fetch", "--quiet", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"], fetchMs);
  if (result.status === 0) return { fetched: true };
  log(`provision-worktree: cloud container; could not fetch origin's main within ${fetchMs} ms (${result.error?.message || result.stderr.trim() || `exit ${result.status}`}), so origin/main may be old`);
  return { fetched: false };
}

export function installedNodes(env, opt = "/opt") {
  const found = [];
  try {
    for (const entry of readdirSync(opt)) found.push(path.join(opt, entry, "bin", "node"));
  } catch {
  }
  for (const dir of (env.PATH ?? "").split(path.delimiter)) if (dir) found.push(path.join(dir, "node"));
  return [...new Set(found)].filter((bin) => existsSync(bin));
}

function nodeVersion(bin) {
  const result = spawnSync(bin, ["-v"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function newer(a, b) {
  const [x, y] = [a, b].map((v) => v.replace(/^v/, "").split(".").map(Number));
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
}

export function cloudNode({ root = repoRoot, env = process.env, version = process.version, nodes, versionOf = nodeVersion, log = () => {} } = {}) {
  const refusal = inCloud(env) ? floorRefusal(version, root) : undefined;
  if (refusal === undefined) return {};
  const meeting = (nodes ?? installedNodes(env))
    .map((bin) => ({ bin, version: versionOf(bin) }))
    .filter((node) => /^v?\d+\.\d+\.\d+/.test(node.version ?? "") && floorRefusal(node.version, root) === undefined)
    .sort((a, b) => newer(a.version, b.version));
  if (meeting.length === 0) {
    return { message: `${refusal} In this cloud container no installed Node.js meets it (searched /opt/*/bin and the path).` };
  }
  const dir = path.dirname(meeting[0].bin);
  const line = `export PATH='${dir.replaceAll("'", "'\\''")}':"$PATH"`;
  if (!env.CLAUDE_ENV_FILE) {
    return { dir, message: `${refusal} Node.js ${meeting[0].version} is installed at ${dir}: run \`${line}\` before any pnpm or node command.` };
  }
  let written = "";
  try {
    written = readFileSync(env.CLAUDE_ENV_FILE, "utf8");
  } catch {
  }
  if (!written.split("\n").includes(line)) writeFileSync(env.CLAUDE_ENV_FILE, `${written}${written && !written.endsWith("\n") ? "\n" : ""}${line}\n`);
  log(`provision-worktree: cloud container's Node.js ${version} is below the engines floor; Node.js ${meeting[0].version} at ${dir} put first on the session's path`);
  return { dir };
}

export function pinnedNode({ root = repoRoot, version = process.version, platform = process.platform, env = process.env } = {}) {
  let pin;
  try {
    pin = readFileSync(path.join(root, ".node-version"), "utf8").trim().replace(/^v/, "");
  } catch {
    return undefined;
  }
  if (!pin || version.replace(/^v/, "") === pin) return undefined;
  const fix =
    platform === "win32"
      ? `run \`winget install --id OpenJS.NodeJS.LTS --exact --version ${pin} --force\``
      : env.NVM_DIR
        ? `run \`nvm install ${pin} && nvm alias default ${pin}\``
        : `install Node.js ${pin} exactly (from https://nodejs.org/dist/v${pin}/, or your version manager)`;
  return `Node.js ${version} runs here, but this project pins ${pin} (.node-version), which CI runs: ${fix}, then start a new shell.`;
}

export function installEnvironment(env = process.env) {
  const out = { ...env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
  if (out.ONNXRUNTIME_NODE_INSTALL === undefined) out.ONNXRUNTIME_NODE_INSTALL = "skip";
  return out;
}

function storytreeCommand(root, args) {
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(root, "packages", "cli", "src", "bins", "storytree.ts"), ...args], {
    cwd: root,
    stdio: ["ignore", 2, 2],
    timeout: 120_000,
    windowsHide: true,
  });
  return { ok: !result.error && result.status === 0, code: result.status ?? 1 };
}

function librarySet(home) {
  try {
    return JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8"))?.library !== undefined;
  } catch {
    return false;
  }
}

export function connectCloud({
  root = repoRoot,
  env = process.env,
  home = env.STORYTREE_HOME ? path.resolve(env.STORYTREE_HOME) : path.join(homedir(), ".storytree", "0.3"),
  run = (args) => storytreeCommand(root, args),
  log = () => {},
} = {}) {
  if (!inCloud(env) || !env.CF_ACCESS_CLIENT_ID || librarySet(home)) return { ok: true, done: false };
  const [projectFile, ignoreFile, rootMarker] = [".storytree/project.json", ".storytree/.gitignore", ".storytree.json"].map((file) => path.join(root, file));
  const touched = [projectFile, ignoreFile, rootMarker];
  const marker = [projectFile, rootMarker].find((file) => existsSync(file));
  const before = new Map(touched.map((file) => [file, existsSync(file) ? readFileSync(file) : undefined]));
  const madeFolder = !existsSync(path.join(root, ".storytree"));
  let project, committed;
  try {
    committed = readFileSync(marker);
    project = JSON.parse(committed.toString("utf8")).project;
  } catch {
  }
  const address = env.STORYTREE_LIBRARY_ADDRESS || cloudLibraryAddress(env);
  const steps = [["settings", "set", "library", "postgres", address]];
  if (typeof project === "string" && project !== "") steps.push(["doctor", "--join", project]);
  for (const args of steps) {
    log(`provision-worktree: cloud container; storytree ${args.join(" ")}`);
    const result = run(args);
    if (args[0] === "doctor" && committed !== undefined) {
      for (const [file, was] of before) {
        if (was === undefined) rmSync(file, { force: true });
        else writeFileSync(file, was);
      }
      if (madeFolder) rmSync(path.join(root, ".storytree"), { recursive: true, force: true });
    }
    if (!result.ok) {
      log(`provision-worktree: storytree ${args.join(" ")} failed (exit ${result.code}); set it by hand (infra/library-host/README.md)`);
      return { ok: false, done: false };
    }
  }
  return { ok: true, done: true };
}

function factoryFolder(env, home) {
  if (env.STORYTREE_FACTORY) return path.resolve(env.STORYTREE_FACTORY);
  const parent = path.dirname(home);
  return path.join(path.basename(parent) === ".storytree" ? parent : home, "your-factory");
}

export function cloudFactory({
  root = repoRoot,
  env = process.env,
  home = env.STORYTREE_HOME ? path.resolve(env.STORYTREE_HOME) : path.join(homedir(), ".storytree", "0.3"),
  factory,
  tokenVar,
  plugin,
  git = (args, { env: extra } = {}) =>
    spawnSync("git", args, { cwd: root, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...extra }, stdio: ["ignore", 2, 2], timeout: 120_000, windowsHide: true }),
  run = (args) => storytreeCommand(root, args),
  install = pnpmInstall,
  log = () => {},
} = {}) {
  if (!inCloud(env) || !factory) return { ok: true, done: false };
  const token = env[tokenVar];
  if (!token) return { ok: true, done: false, message: `The factory ${factory} was not loaded: its token variable ${tokenVar} is not set in this cloud session.` };
  const folder = factoryFolder(env, home);
  const failed = (step, code) => {
    log(`provision-worktree: cloud container; loading the factory: ${step} failed (${code}), so its plugin is not named`);
    return { ok: false, done: false };
  };
  log(`provision-worktree: cloud container; loading the factory ${factory} into ${folder}`);
  const header = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  const gitEnv = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.extraHeader", GIT_CONFIG_VALUE_0: header };
  const cloned = existsSync(path.join(folder, ".git"));
  const fetched = git(cloned ? ["-C", folder, "pull", "--ff-only", "--", factory, "main"] : ["clone", "--depth", "1", "--", factory, folder], { env: gitEnv });
  if (fetched.status !== 0) return failed(cloned ? "git pull" : "git clone", fetched.error?.message ?? `exit ${fetched.status}`);
  try {
    const link = path.join(folder, "storytree");
    rmSync(link, { force: true });
    symlinkSync(path.resolve(root), link, "junction");
  } catch (error) {
    return failed("linking this checkout as storytree", error.code ?? error.message);
  }
  const installed = install(folder);
  if (!installed.ok) return failed(`pnpm install in ${folder}`, `exit ${installed.code}`);
  const args = ["settings", "set", "module", plugin, "plugin", plugin];
  const named = run(args);
  if (!named.ok) return failed(`storytree ${args.join(" ")}`, `exit ${named.code}`);
  return { ok: true, done: true };
}

export function pnpmInstall(root, { spawn = spawnSync, platform = process.platform } = {}) {
  const options = { cwd: root, stdio: ["ignore", 2, 2], env: installEnvironment() };
  const run =
    platform === "win32"
      ? (command) => spawn(command, { ...options, shell: true })
      : (command) => spawn(command.split(" ")[0], command.split(" ").slice(1), options);
  let result = run("pnpm install --frozen-lockfile");
  if (result.error?.code === "ENOENT") result = run("corepack pnpm install --frozen-lockfile");
  return { ok: !result.error && result.status === 0, code: result.status ?? 1 };
}

function electronPackages(root) {
  const store = path.join(root, "node_modules", ".pnpm");
  let entries;
  try {
    entries = readdirSync(store);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.startsWith("electron@"))
    .map((entry) => path.join(store, entry, "node_modules", "electron"))
    .filter((dir) => existsSync(path.join(dir, "install.js")));
}

function hasBinary(dir) {
  try {
    return existsSync(path.join(dir, "dist", readFileSync(path.join(dir, "path.txt"), "utf8").trim()));
  } catch {
    return false;
  }
}

function fetchElectron(root, log) {
  for (const dir of electronPackages(root)) {
    if (hasBinary(dir)) continue;
    log(`provision-worktree: fetching Electron's binary into ${dir}`);
    const result = spawnSync(process.execPath, [path.join(dir, "install.js")], {
      cwd: dir,
      stdio: ["ignore", 2, 2],
      timeout: 120_000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0 || !hasBinary(dir)) {
      log(`provision-worktree: Electron's binary could not be fetched into ${dir} (${result.error?.message ?? `exit ${result.status}`}); it is fetched on first require instead`);
    }
  }
}

const HOOK_MARK = "# storytree push check";

function hookText(fallback) {
  const slashed = fallback.replaceAll("\\", "/");
  return [
    "#!/bin/sh",
    `${HOOK_MARK}, installed by packages/base-dev-loop/src/provision-worktree.mjs: refuses a push that adds a credential held on this machine.`,
    'top="$(git rev-parse --show-toplevel)"',
    'script="$top/packages/repo-checks/src/push-check.mjs"',
    `[ -f "$script" ] || script='${slashed.replaceAll("'", "'\\''")}'`,
    '[ -f "$script" ] || exit 0',
    'exec node "$script" "$@"',
    "",
  ].join("\n");
}

export function installPushHook({ root, fallback }) {
  const git = (...args) => path.resolve(root, execFileSync("git", ["rev-parse", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim());
  let hooks;
  try {
    hooks = git("--git-path", "hooks");
    const main = path.join(path.dirname(git("--git-common-dir")), "packages", "repo-checks", "src", "push-check.mjs");
    fallback ??= existsSync(main) ? main : path.join(repoRoot, "packages", "repo-checks", "src", "push-check.mjs");
  } catch {
    return "not a git checkout: no push check installed";
  }
  const hook = path.join(hooks, "pre-push");
  const text = hookText(fallback);
  if (existsSync(hook)) {
    const current = readFileSync(hook, "utf8");
    if (!current.includes(HOOK_MARK)) return `a pre-push hook of someone else's is at ${hook}: the push check was not added`;
    if (current === text) return "push check current";
  }
  mkdirSync(hooks, { recursive: true });
  writeFileSync(hook, text);
  chmodSync(hook, 0o755);
  return `push check installed at ${hook}`;
}

export function provision({ root = repoRoot, install = pnpmInstall, retries = 1, log = () => {}, update = {} } = {}) {
  if (superproject(root)) return { ok: true, code: 0 };
  const message = updateCheckout(root, { ...update, log });
  if (message) {
    log(message);
    return { ok: false, condition: "checkout", message, code: 1 };
  }
  const hook = installPushHook({ root });
  if (/installed|someone else's/.test(hook)) log(`provision-worktree: ${hook}`);
  const condition = conditionOf(root);
  if (condition === undefined) {
    fetchElectron(root, log);
    return { ok: true, code: 0 };
  }
  const attempts = retries + 1;
  let last = { ok: false, code: 1 };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    log(`provision-worktree: ${condition} worktree at ${root}; pnpm install (attempt ${attempt} of ${attempts})`);
    last = install(root);
    if (last.ok) {
      fetchElectron(root, log);
      return { ok: true, condition, code: 0 };
    }
  }
  log(`provision-worktree: pnpm install failed ${attempts} times (exit ${last.code})`);
  return { ok: false, condition, code: last.code || 1 };
}

function startServer(root) {
  const server = path.join(root, "packages", "mcp-server", "src", "bins", "storytree-mcp.ts");
  const child = spawn(process.execPath, ["--import", "tsx", server], { cwd: root, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  return new Promise((resolve) => {
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

export async function serve({ root = repoRoot, start = startServer, pollMs = 500, waitMs = 240_000, log = (line) => process.stderr.write(`${line}\n`), update = {} } = {}) {
  const refusal = updateCheckout(root, { ...update, log });
  if (refusal) {
    log(refusal);
    return 1;
  }
  const until = Date.now() + waitMs;
  while (conditionOf(root) !== undefined && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, pollMs));
  return start(root);
}

const WHAT_HAPPENED = {
  fresh: "is FRESH: no pnpm install has completed in it, and the automatic one at session start failed",
  stale:
    "is STALE: pnpm-lock.yaml has moved past the one its node_modules was installed from (a dependency " +
    "landed on main since), and the automatic refresh at session start failed",
  unlinked:
    "is UNLINKED: a pnpm install reported success but linked no workspace package, and the automatic " +
    'reinstall at session start failed. A later install may again print "Already up to date"; check ' +
    "that the packages have a node_modules afterwards",
  behind:
    "is BEHIND: the root or a workspace package depends on another its node_modules has no link to (a workspace " +
    "package landed on main since the last install), and the automatic reinstall at session start failed",
};

export function checkOutput(root) {
  const condition = conditionOf(root);
  if (condition !== "fresh" && condition !== "unlinked" && condition !== "behind") return "";
  const state =
    condition === "behind"
      ? `BEHIND, its install lacking the link ${missingLink(root)}`
      : `${condition.toUpperCase()}, not installed`;
  return (
    `storytree: this worktree (${root}) is ${state}, so the command line cannot start: ` +
    "run `node packages/base-dev-loop/src/provision-worktree.mjs` in it, then run the command again."
  );
}

export function check({ root = repoRoot, install = pnpmInstall, log = () => {} } = {}) {
  if (!checkOutput(root)) return 0;
  const outer = superproject(root);
  if (outer) {
    log(
      `storytree: this checkout (${root}) is a submodule of ${outer}, whose own install it uses, so it is never installed ` +
      "and the command line cannot start in it: run storytree's commands from a storytree checkout of its own.",
    );
    return 1;
  }
  provision({ root, install, log, update: { fastForward: false } });
  const refusal = checkOutput(root);
  if (refusal) log(refusal);
  return refusal ? 1 : 0;
}

export function hookOutput(result, root, notes = []) {
  const install = result.ok
    ? []
    : [result.message ??
      `This worktree (${root}) ${WHAT_HAPPENED[result.condition]}. Run \`pnpm install\` in ${root} before ` +
      "any pnpm, tsx or test command: until then they fail with errors such as ERR_MODULE_NOT_FOUND or " +
      "TS2307 that name the wrong cause."];
  const additionalContext = [...install, ...notes].join("\n\n");
  if (!additionalContext) return "";
  return JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } });
}

function isEntry() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  const args = process.argv.slice(2);
  const hook = args.includes("--hook");
  const at = args.indexOf("--root");
  const root = at === -1 ? repoRoot : path.resolve(args[at + 1]);
  if (args.includes("--serve")) {
    process.exitCode = await serve({ root });
  } else if (args.includes("--check")) {
    process.exitCode = check({ root, log: (line) => process.stderr.write(`${line}\n`) });
  } else {
    const log = (line) => process.stderr.write(`${line}\n`);
    const node = cloudNode({ root, log });
    cloudMain({ root, log });
    const result = provision({ root, log });
    const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
    let loaded = {};
    if (result.ok) {
      connectCloud({ root, log });
      loaded = cloudFactory({ root, factory: flag("--factory"), tokenVar: flag("--factory-token"), plugin: flag("--factory-plugin"), log });
    }
    const notes = [node.message, loaded.message, pinnedNode({ root })].filter(Boolean);
    const output = hook ? hookOutput(result, root, notes) : "";
    if (output) process.stdout.write(`${output}\n`);
    process.exitCode = hook ? 0 : result.code;
  }
}

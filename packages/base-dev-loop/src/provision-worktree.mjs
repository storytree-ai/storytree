// Capability 3 · Worktree setup. The fresh-worktree install: run at every session start (.claude/settings.json and
// .codex/hooks.json), it gives a 0.3 worktree that cannot run its own code a `pnpm install`, retried
// once, and tells the agent plainly if it still cannot. Ported from storytree 0.2's
// packages/cli/provision-worktree.mjs (ADR-0636 D1, b4 folded into b5; ADR-0633 D2).
//
// Four conditions call for an install, and each is named in what the agent is told, because all
// four look the same at the first tool call (a module that will not resolve) and have different
// causes:
//   - FRESH: no install ever completed here. pnpm writes node_modules/.modules.yaml only when an
//     install completes, so an install killed midway is fresh too, and heals next session.
//   - STALE: pnpm-lock.yaml has moved past the lockfile the last install ran against, which pnpm
//     keeps as node_modules/.pnpm/lock.yaml. It happens when main is merged in after a dependency
//     landed, and the error it causes blames a package this session never touched.
//   - UNLINKED: an install reported success but no workspace package got a node_modules of its own
//     (0.2 met this: "Already up to date", exit 0, and nothing could run). The root's node_modules
//     holds no .bin in a pnpm workspace even when healthy, so the packages are where to look.
//   - BEHIND: the root or a workspace package depends on another (`workspace:` in its package.json) that its
//     node_modules has no link to. It happens when main adds a workspace package after the last
//     install: the lockfile can match and every package still has a node_modules, yet the first
//     import of the new package fails, naming it, not the cause.
// Anything else is left alone at no cost, so the hook is safe to run at every session start.
// Once installed, an Electron package with no binary has it fetched (contract 3.5): Electron has no
// postinstall since 44, so pnpm install alone leaves tests run under Electron's runtime skipping.
//
// With --serve it is how 0.3's own sessions start the MCP server (.mcp.json and
// .codex/config.toml, ADR-0793 D2): the harness starts the server beside the session-start hook,
// so in a worktree still being installed it waits for that install, then runs the server from this
// worktree's source. It never installs itself, so two installs never run in one worktree at once.
// A primary checkout on main behind locally fetched origin/main is refused before it can serve
// old code against newer records. The hook names the gap and pull/install/restart repair too.
// This checks local Git refs only: no network wait, checkout update or change to linked worktrees.
//
// With --check it is what `pnpm storytree` runs first: a worktree that is FRESH, UNLINKED or BEHIND
// cannot start the command line at all, and the crash names a missing module (often @storytree/app), not
// the cause. A session reaches it when its start hook never ran in this worktree, or ran before the
// worktree reached its final commit (a launch path we cannot see from here: two Windows desktop
// worktrees met it, each healed by running this script by hand), so it installs the worktree itself,
// as the hook would have, and refuses in one line that names the command to run only if it still
// cannot start. STALE is let through: the command line usually still runs, and the session-start
// refresh or `pnpm install` is its fix.
// Missing links take priority over STALE: a matching lockfile is not proof that the links exist,
// and a different installed lockfile must not hide a link the command line needs.
//
// In a Claude Code cloud container (CLAUDE_CODE_REMOTE=true, contract 3.6, ADR-1093) every session
// starts in a fresh container: no storytree settings, no approved checkout, and an install whose
// onnxruntime download the agent proxy keeps cutting off (which also timed out the MCP server's start).
// So there the install skips that download, and once installed, a container that holds the route's
// Access token but no library setting is given the library's HTTPS address (STORYTREE_LIBRARY_ADDRESS
// when the environment sets it, else the route with PGUSER as its user, storytree_library when unset)
// and approves this checkout as its project's, through storytree's own command line, putting the
// checkout's committed marker (.storytree/project.json) back after the join. The password and the Access token come
// from the environment itself (PGPASSWORD, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET), so nothing
// secret is written. infra/library-host/README.md describes the route.
//
// Before anything else, it installs the push check (packages/repo-checks/src/push-check.mjs, contract 3.7) as git's pre-push hook, in the
// hooks folder the repository's worktrees share, unless someone else's pre-push hook is already there.
//
// It runs before node_modules exists, so it uses Node built-ins only. With --hook it always exits 0
// (a failed install must never break the session) and writes to stdout only the heads-up for the
// agent, as SessionStart additionalContext; pnpm's own output goes to stderr.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// On Windows a bare-named program (git, pnpm) is found on PATH only, never in the checkout it runs in; every
// process it starts inherits that.
if (process.platform === "win32") process.env.NoDefaultCurrentDirectoryInExePath ??= "1";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const WORKSPACE_GROUPS = ["packages", "apps"];

/** A known-stale primary must be repaired before this process loads Session management's source. */
function checkoutRefusal(root) {
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 5_000, windowsHide: true });
    return result.status === 0 ? result.stdout.trim() : "";
  };
  const dirs = git("rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir").split(/\r?\n/);
  if (dirs.length !== 2 || dirs[0] !== dirs[1]) return ""; // Not Git, or a linked worktree.
  if (git("symbolic-ref", "--quiet", "--short", "HEAD") !== "main") return "";
  const counts = git("rev-list", "--left-right", "--count", "HEAD...refs/remotes/origin/main");
  if (!/^\d+\s+\d+$/.test(counts)) return ""; // No fetched main to compare yet.
  const [ahead, behind] = counts.split(/\s+/).map(Number);
  if (behind === 0) return "";
  const reconcile = ahead > 0
    ? ` It also has ${ahead} local commit${ahead === 1 ? "" : "s"}; reconcile those with origin/main before the fast-forward.`
    : "";
  return `storytree: the primary checkout (${root}) on main is ${behind} commit${behind === 1 ? "" : "s"} behind locally fetched origin/main; ` +
    `the MCP server cannot start from this older code.${reconcile} Preserve any local edits, then run ` +
    "`git pull --ff-only origin main && pnpm install` in that checkout and restart the session's MCP server.";
}

/** Which condition calls for an install, or undefined when the worktree is installed and current. */
function conditionOf(root) {
  const modules = path.join(root, "node_modules");
  if (!existsSync(path.join(modules, ".modules.yaml"))) return "fresh";
  if (unlinked(root)) return "unlinked";
  if (missingLink(root)) return "behind";
  if (lockfileAdvanced(root)) return "stale";
  return undefined;
}

/** Each workspace package's folder and parsed package.json, skipping any that cannot be read. */
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
        // No package.json, or one that will not parse: not a package this check can judge.
      }
    }
  }
}

/** The first workspace dependency with no link in its dependant's node_modules, as "dependant → dependency", or undefined. */
function missingLink(root) {
  const packages = [...workspacePackages(root)];
  try {
    packages.unshift({ dir: root, manifest: JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) });
  } catch {
    // Like a workspace package, an unreadable root manifest is not one this check can judge.
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

/** True when pnpm-lock.yaml differs from the one the last install ran against. Unreadable is not stale. */
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

/** True when the workspace has packages and not one of them has its own node_modules. */
function unlinked(root) {
  let packages = 0;
  for (const { dir } of workspacePackages(root)) {
    packages++;
    if (existsSync(path.join(dir, "node_modules"))) return false;
  }
  return packages > 0;
}

/** The library's address over the HTTPS route (ADR-1093): its user (env's PGUSER, else storytree_library), host and database, never its password. */
function cloudLibraryAddress(env) {
  return `wss://${encodeURIComponent(env.PGUSER || "storytree_library")}@library.storytree.dev/postgres`;
}

/** True in a Claude Code cloud container. */
function inCloud(env) {
  return env.CLAUDE_CODE_REMOTE === "true";
}

/** The environment pnpm install runs with: onnxruntime's download skipped everywhere unless env says otherwise. */
export function installEnvironment(env = process.env) {
  const out = { ...env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
  if (out.ONNXRUNTIME_NODE_INSTALL === undefined) out.ONNXRUNTIME_NODE_INSTALL = "skip";
  return out;
}

/** Run storytree's command line from root's source with args. Never throws. */
function storytreeCommand(root, args) {
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(root, "packages", "cli", "src", "bins", "storytree.ts"), ...args], {
    cwd: root,
    stdio: ["ignore", 2, 2],
    timeout: 120_000,
    windowsHide: true,
  });
  return { ok: !result.error && result.status === 0, code: result.status ?? 1 };
}

/** True when the storytree home's settings already say where the library is. Unreadable is unset. */
function librarySet(home) {
  try {
    return JSON.parse(readFileSync(path.join(home, "settings.json"), "utf8"))?.library !== undefined;
  } catch {
    return false;
  }
}

/**
 * In a fresh cloud container holding the route's Access token, give storytree the library's address
 * and approve root as its project's checkout (contract 3.6). Elsewhere, or once the library is set, nothing.
 * @returns {{ ok: boolean, done: boolean }}
 */
export function connectCloud({
  root = repoRoot,
  env = process.env,
  home = env.STORYTREE_HOME ? path.resolve(env.STORYTREE_HOME) : path.join(homedir(), ".storytree", "0.3"),
  run = (args) => storytreeCommand(root, args),
  log = () => {},
} = {}) {
  if (!inCloud(env) || !env.CF_ACCESS_CLIENT_ID || librarySet(home)) return { ok: true, done: false };
  // Joining rewrites the checkout's marker with the library's identity, at .storytree/project.json (ADR-1191);
  // the files it writes are put back as committed, or taken away, so a cloud session's tree stays clean
  // (routing reads the project name either way).
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
    // No project named: only the address is given.
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

/** `pnpm install --frozen-lockfile` in root, falling back to `corepack pnpm`. Never throws. */
export function pnpmInstall(root, { spawn = spawnSync, platform = process.platform } = {}) {
  const options = { cwd: root, stdio: ["ignore", 2, 2], env: installEnvironment() };
  // Windows finds the pnpm.cmd and corepack.cmd shims only through a shell; the commands are fixed
  // strings, so the shell is given nothing from outside.
  const run =
    platform === "win32"
      ? (command) => spawn(command, { ...options, shell: true })
      : (command) => spawn(command.split(" ")[0], command.split(" ").slice(1), options);
  let result = run("pnpm install --frozen-lockfile");
  if (result.error?.code === "ENOENT") result = run("corepack pnpm install --frozen-lockfile");
  return { ok: !result.error && result.status === 0, code: result.status ?? 1 };
}

/** Each Electron package in root's virtual store, as its folder. */
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

/** True when an Electron package holds its binary: path.txt names a file under dist/. */
function hasBinary(dir) {
  try {
    return existsSync(path.join(dir, "dist", readFileSync(path.join(dir, "path.txt"), "utf8").trim()));
  } catch {
    return false;
  }
}

/**
 * Fetch each installed Electron's binary that is missing, with the package's own install.js (which
 * reads ~/.cache/electron before the network). Electron has no postinstall since 44, so pnpm install
 * leaves it without one, and tests run under Electron's runtime would skip. A failed fetch is only
 * logged: Electron still fetches on first require, so it must never fail the session.
 */
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

/** The line that marks a pre-push hook as storytree's own, so it is updated in place and no other hook is touched. */
const HOOK_MARK = "# storytree push check";

/** The hook's text: the pushing checkout's own push check, else `fallback`'s (a checkout whose branch predates it). */
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

/**
 * Install the pre-push hook in the hooks folder git uses for `root` (one for a repository and all its worktrees, or
 * core.hooksPath), leaving a hook someone else installed in place. Its fallback is the main checkout's push check,
 * which outlives a worktree's, else this checkout's. Returns what happened, for the log.
 */
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

/**
 * Install root's dependencies if it is fresh, stale, unlinked or behind, trying `retries` more times after a
 * failure (a failed install leaves the store warm, so the retry is quick).
 * @returns {{ ok: boolean, condition?: "fresh" | "stale" | "unlinked" | "behind" | "checkout", message?: string, code: number }}
 */
export function provision({ root = repoRoot, install = pnpmInstall, retries = 1, log = () => {} } = {}) {
  const message = checkoutRefusal(root);
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

/** Run the MCP server from root's source, over this process's stdin and stdout, to its exit code. */
function startServer(root) {
  const server = path.join(root, "packages", "mcp-server", "src", "bins", "storytree-mcp.ts");
  const child = spawn(process.execPath, ["--import", "tsx", server], { cwd: root, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  return new Promise((resolve) => {
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

/**
 * Start the tool server once root is installed, waiting up to waitMs for the session-start hook's
 * install; past that it starts anyway, and the harness reports what failed.
 * @returns {Promise<number>} the server's exit code
 */
export async function serve({ root = repoRoot, start = startServer, pollMs = 500, waitMs = 240_000, log = (line) => process.stderr.write(`${line}\n`) } = {}) {
  const refusal = checkoutRefusal(root);
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

/** The one line --check writes to stderr for an uninstalled root, or "" when the command line can run. */
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

/**
 * What `pnpm storytree` runs first: a worktree the command line cannot start in is installed as the
 * session-start hook would have, and refused (in one line, through log) only if it still cannot.
 * @returns {number} the exit code
 */
export function check({ root = repoRoot, install = pnpmInstall, log = () => {} } = {}) {
  if (!checkOutput(root)) return 0;
  provision({ root, install, log });
  const refusal = checkOutput(root);
  if (refusal) log(refusal);
  return refusal ? 1 : 0;
}

/** What the hook writes to stdout for a result: the agent's heads-up when the install failed, else "". */
export function hookOutput(result, root) {
  if (result.ok) return "";
  const additionalContext = result.message ??
    `This worktree (${root}) ${WHAT_HAPPENED[result.condition]}. Run \`pnpm install\` in ${root} before ` +
    "any pnpm, tsx or test command: until then they fail with errors such as ERR_MODULE_NOT_FOUND or " +
    "TS2307 that name the wrong cause.";
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
    const result = provision({ root, log });
    if (result.ok) connectCloud({ root, log });
    const output = hook ? hookOutput(result, root) : "";
    if (output) process.stdout.write(`${output}\n`);
    process.exitCode = hook ? 0 : result.code;
  }
}

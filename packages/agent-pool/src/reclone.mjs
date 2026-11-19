// Capability 9 · A machine moves onto a fresh clone of the repository, keeping its old checkout (9.1).
import { execFile, spawn } from "node:child_process";
import { existsSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { mkdir, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { lanesBeside } from "./pause.mjs";
import { poolConfig } from "./pool-config.mjs";
import { forget } from "./watch.mjs";

const run = promisify(execFile);
const windows = process.platform === "win32";
const git = async (args, cwd) => (await run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout;
const pnpm = async (args, cwd) => (await run("pnpm", args, { cwd, shell: windows, maxBuffer: 64 * 1024 * 1024 })).stdout;
const real = (path) => existsSync(path) ? realpathSync.native(path) : resolve(path);
const inside = (path, folder) => { const rel = relative(folder, path); return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)); };

export function worktreesOf(porcelain) {
  return porcelain.trim().split(/\n\n+/).filter(Boolean).map((block) => {
    const lines = block.split("\n"), field = (name) => lines.find((line) => line.startsWith(`${name} `))?.slice(name.length + 1);
    return { path: resolve(field("worktree")), branch: field("branch"), detached: lines.includes("detached"), locked: lines.some((line) => line === "locked" || line.startsWith("locked ")) };
  });
}

export function slugOf(url) {
  const found = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
  if (!found) throw new Error(`not a GitHub repository URL: ${url}`);
  return found[1];
}

export async function planReclone({ checkout, repo, lanes, stamp, x }) {
  checkout = resolve(checkout);
  const aside = `${checkout}.before-${stamp}`;
  if (!existsSync(join(checkout, ".git"))) throw new Error(`${checkout} is not a git checkout`);
  if (existsSync(aside)) throw new Error(`${aside} already exists: nothing moved`);
  const own = real(checkout);
  const trees = worktreesOf(await x.git(["worktree", "list", "--porcelain"], checkout)).filter((tree) => real(tree.path) !== own);
  const follow = trees.filter((tree) => tree.detached && !inside(real(tree.path), own));
  const left = trees.filter((tree) => !tree.detached && !inside(real(tree.path), own));
  const within = trees.filter((tree) => inside(real(tree.path), own));
  for (const tree of follow) if (existsSync(`${tree.path}.before-${stamp}`)) throw new Error(`${tree.path}.before-${stamp} already exists: nothing moved`);
  const pushUrl = (await x.git(["config", "--get", "remote.origin.pushurl"], checkout).catch(() => "")).trim();
  const steps = [];
  steps.push({ say: `move ${checkout} to ${aside} (kept whole, with its ${within.length} worktree${within.length === 1 ? "" : "s"} inside it)`, act: () => x.rename(checkout, aside) });
  for (const tree of follow) steps.push({ say: `move follow-main worktree ${tree.path} to ${tree.path}.before-${stamp}`, act: () => x.rename(tree.path, `${tree.path}.before-${stamp}`) });
  const moved = [...within.map((tree) => join(aside, relative(own, real(tree.path)))), ...follow.map((tree) => `${tree.path}.before-${stamp}`)];
  if (moved.length) steps.push({ say: `repair the moved-aside checkout's links to its ${moved.length} worktree${moved.length === 1 ? "" : "s"}`, act: () => x.git(["worktree", "repair", ...moved], aside) });
  steps.push({ say: `clone ${repo} into ${checkout}`, act: () => x.git(["clone", "--quiet", "--", repo, checkout], resolve(checkout, "..")) });
  if (pushUrl) {
    const host = /^git@(github\.com(?:-[\w.-]+)?):/.exec(pushUrl)?.[1] ?? "github.com";
    const url = /github\.com/.test(repo) ? `git@${host}:${slugOf(repo)}.git` : repo;
    steps.push({ say: `push over SSH, as the old checkout did (${url})`, act: () => x.git(["config", "remote.origin.pushurl", url], checkout) });
  }
  steps.push({ say: "install", act: () => x.install(checkout) });
  steps.push({ say: `make the lane worktree root ${join(checkout, ".claude", "worktrees")}`, act: () => x.mkdir(join(checkout, ".claude", "worktrees")) });
  for (const tree of follow) steps.push({ say: `make follow-main worktree ${tree.path} again, at origin/main${tree.locked ? ", locked" : ""}`,
    act: () => x.git(["worktree", "add", "--quiet", ...(tree.locked ? ["--lock"] : []), "--detach", tree.path, "origin/main"], checkout) });
  if (lanes) {
    const watch = join(lanes, "watch");
    steps.push({ say: `set the watcher's hand-offs in ${watch} aside (pull request numbers start again)`, act: async () => {
      const { prs, to } = await x.forget(watch);
      return prs.length ? `set aside ${prs.map((pr) => `#${pr}`).join(", ")} into ${to}` : "no hand-offs";
    } });
    steps.push({ say: "restart the watcher on the new clone, if one was running", act: () => x.restartWatcher({ watch, checkout }) });
  }
  steps.push({ say: "check storytree's own commands reach the library (settings show, arc list)", act: () => x.check(checkout) });
  if (left.length) steps.push({ say: `left on the moved-aside checkout: ${left.length} branch worktree${left.length === 1 ? "" : "s"} outside it (${left.map((tree) => tree.path).join(", ")})`, act: async () => {} });
  return { aside, follow, steps };
}

export async function reclone({ steps, apply, say = console.log }) {
  say(apply ? "re-clone:" : "re-clone, dry run (nothing changes; --apply does it):");
  for (const [n, step] of steps.entries()) {
    say(`${n + 1}. ${step.say}`);
    if (!apply) continue;
    try {
      const note = await step.act();
      if (typeof note === "string" && note.trim()) say(`   ${note.trim().split("\n").join("\n   ")}`);
    } catch (error) {
      const why = [String(error.message).split("\n")[0], ...[error.stderr, error.stdout].map((text) => String(text ?? "").trim().split("\n").at(-1)).filter(Boolean)];
      say(`   failed: ${[...new Set(why)].join(": ")}\nstopped at step ${n + 1}; steps before it are done, and nothing was deleted`);
      return 1;
    }
  }
  return 0;
}

export function runningInside(folder, proc = "/proc") {
  if (!existsSync(proc)) return [];
  const found = [];
  for (const pid of readdirSync(proc).filter((name) => /^\d+$/.test(name))) {
    try { if (inside(readlinkSync(join(proc, pid, "cwd")), folder)) found.push(pid); } catch {}
  }
  return found;
}

export function loopsInside(folder, proc = "/proc") {
  return runningInside(folder, proc).filter((pid) => {
    try { return /^(?:\S*\/)?(?:ba)?sh\s+(?:\S*\/)?launch-pool\.sh\s+run\b/.test(readFileSync(join(proc, pid, "cmdline"), "utf8").split("\0").join(" ")); } catch { return false; }
  });
}

async function argsOf(pid) {
  return (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).split("\0").join(" ").trim();
}

function commands() {
  return {
    git, rename, mkdir: (path) => mkdir(path, { recursive: true }),
    install: (checkout) => pnpm(["install"], checkout).then(() => "installed"),
    forget: (dir) => forget({ dir }),
    check: async (checkout) => {
      await pnpm(["-s", "storytree", "settings", "show"], checkout);
      const arcs = (await pnpm(["-s", "storytree", "arc", "list"], checkout)).trim().split("\n").length;
      return `the library answers (arc list: ${arcs} lines); main is at ${(await git(["log", "--oneline", "-1"], checkout)).trim()}`;
    },
    restartWatcher: async ({ watch, checkout }) => {
      const pids = [];
      for (const file of ["watch.pid", "watch-loop.pid"]) {
        const pid = (await readFile(join(watch, file), "utf8").catch(() => "")).trim();
        if (pid && /agent-pool\/src\/watch\.mjs (run|watch)\b/.test(await argsOf(pid))) pids.push(pid);
      }
      if (!pids.length) return "no watcher was running: the next hand-over starts one";
      for (const pid of pids) process.kill(Number(pid), "SIGTERM");
      const out = openSync(join(watch, "..", "watch.runner.log"), "a");
      const child = spawn(process.execPath, [join(checkout, "packages", "agent-pool", "src", "watch.mjs"), "run"], { cwd: checkout, detached: true, stdio: ["ignore", out, out] });
      child.unref();
      return `stopped the watcher (${pids.join(", ")}) and started it from the new clone (pid ${child.pid})`;
    },
  };
}

export async function main(args, box = {}) {
  const flag = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const say = box.say ?? console.log, home = box.home ?? homedir();
  const config = poolConfig({ home, env: box.env ?? process.env });
  const checkout = flag("--checkout") ?? config.checkout, repo = flag("--repo") ?? "https://github.com/storytree-ai/storytree.git";
  const lanes = flag("--lanes") ?? (existsSync(join(config.lanesDir, "watch")) ? config.lanesDir : undefined);
  const apply = args.includes("--apply");
  if (args.some((arg) => arg.startsWith("--") && !["--checkout", "--repo", "--lanes", "--apply"].includes(arg))) {
    say("usage: reclone.mjs [--checkout <folder>] [--repo <git url>] [--lanes <folder>] [--apply]");
    return 2;
  }
  if (lanes && apply) {
    // eslint-disable-next-line storytree/posix-commands -- lanes is set only on the Mint box, where the lanes folder holds the watcher's hand-offs; the laptop has none.
    const beside = await (box.lanesBeside ?? (async () => lanesBeside((await run("ps", ["-eo", "pid=,ppid=,args="], { maxBuffer: 64 * 1024 * 1024 })).stdout)))();
    if (!existsSync(join(lanes, "pool-stop")) || beside.length) {
      say(`refused: pause the pool first (node --import tsx packages/agent-pool/src/pause.mjs pause): ${existsSync(join(lanes, "pool-stop")) ? `${beside.length} other lane${beside.length === 1 ? " is" : "s are"} still running` : `no stop file in ${lanes}`}`);
      return 1;
    }
    const loops = (box.loopsInside ?? loopsInside)(resolve(checkout));
    if (loops.length) {
      say(`refused: the dispatcher's loop still runs from ${resolve(checkout)} (${loops.join(", ")}), and would start it again on the moved-aside code; it ends once the session that paused the pool does, so pause and re-clone from a session outside the pool`);
      return 1;
    }
  }
  const stamp = new Date((box.now ?? Date.now)()).toISOString().replace(/[-:]|\.\d{3}/g, "");
  let plan;
  try { plan = await planReclone({ checkout, repo, lanes, stamp, x: { ...commands(), ...box.x } }); }
  catch (error) { say(`refused: ${error.message}`); return 1; }
  const code = await reclone({ steps: plan.steps, apply, say });
  if (apply && !code) {
    const still = (box.runningInside ?? runningInside)(plan.aside);
    say(still.length ? `still running from the moved-aside checkout, to restart from the new one: ${still.join(", ")}` : "nothing still runs from the moved-aside checkout");
    say(`done: the old checkout is kept at ${plan.aside}`);
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}

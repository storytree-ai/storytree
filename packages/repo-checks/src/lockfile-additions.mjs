// Capability 3 · Lockfile report. CI's lockfile report (contract 3.1): what a branch adds to the code that installs, for the
// reviewer to read. Against where the branch left main, merge-base(origin/main, HEAD), it lists each external package
// pnpm-lock.yaml's `packages:` section gains, saying whether its name is new or another version of one already there,
// and each dependency pnpm-workspace.yaml newly allows to run its install script (onlyBuiltDependencies: no other
// dependency's script runs, and pnpm's v9 lockfile does not record which packages have one). It is a report, never a
// gate: it prints and writes the run's summary, and refuses nothing. It reads only git and node's own modules, so CI
// runs it before any install. `node packages/repo-checks/src/lockfile-additions.mjs`.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The lockfile's external packages, as `name@version`: the keys of its top-level `packages:` section. */
export function lockPackages(text) {
  const keys = new Set();
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) inPackages = line === "packages:";
    else if (inPackages) {
      const key = /^ {2}(\S.*):$/.exec(line)?.[1];
      if (key) keys.add(key.replace(/^'(.*)'$/, "$1"));
    }
  }
  return keys;
}

/** The dependencies pnpm-workspace.yaml lets run their install scripts. */
export function builtDependencies(text) {
  const names = new Set();
  let inList = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) inList = line.trim() === "onlyBuiltDependencies:";
    else if (inList) {
      const name = /^\s+-\s+(.+?)\s*$/.exec(line)?.[1];
      if (name) names.add(name.replace(/^(["'])(.*)\1$/, "$2"));
    }
  }
  return names;
}

const nameOf = (key) => key.slice(0, key.lastIndexOf("@") || undefined);

/** What head adds to base: packages new to the lockfile, and dependencies newly allowed to run install scripts. */
export function lockfileAdditions({ baseLock, headLock, baseWorkspace, headWorkspace }) {
  const before = lockPackages(baseLock);
  const names = new Set([...before].map(nameOf));
  const packages = [...lockPackages(headLock)].filter((key) => !before.has(key)).sort().map((key) => ({ key, newName: !names.has(nameOf(key)) }));
  const allowed = builtDependencies(baseWorkspace);
  const installScripts = [...builtDependencies(headWorkspace)].filter((name) => !allowed.has(name)).sort();
  return { packages, installScripts };
}

export function reportLines({ packages, installScripts }) {
  if (packages.length === 0 && installScripts.length === 0) return ["This branch adds no external package and allows no new install script."];
  const lines = [];
  if (packages.length > 0) {
    lines.push(`${packages.length} external package${packages.length === 1 ? "" : "s"} added to pnpm-lock.yaml:`);
    for (const { key, newName } of packages) lines.push(`- ${key} (${newName ? "new package" : `another version of ${nameOf(key)}`})`);
  }
  if (installScripts.length > 0) lines.push(`Dependencies newly allowed to run their install scripts: ${installScripts.join(", ")}`);
  return lines;
}

/** Prints the branch's report and appends it to the run's summary when one is given (GITHUB_STEP_SUMMARY). */
export async function reportLockfileAdditions({ root = process.cwd(), base = "origin/main", summary = process.env.GITHUB_STEP_SUMMARY, log = console.log } = {}) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const from = git("merge-base", base, "HEAD").trim();
  // A file the merge base lacks is empty there, so everything in it is an addition.
  const at = (commit, file) => { try { return git("show", `${commit}:${file}`); } catch { return ""; } };
  const lines = reportLines(lockfileAdditions({
    baseLock: at(from, "pnpm-lock.yaml"), headLock: at("HEAD", "pnpm-lock.yaml"),
    baseWorkspace: at(from, "pnpm-workspace.yaml"), headWorkspace: at("HEAD", "pnpm-workspace.yaml"),
  }));
  for (const line of lines) log(line);
  if (summary) appendFileSync(summary, lines.join("\n") + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await reportLockfileAdditions({ root: fileURLToPath(new URL("../../..", import.meta.url)) });
}

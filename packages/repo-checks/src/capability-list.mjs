// Capability 4 · Capability-list check

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { withLibrary } from "./library-reach.mjs";

export function incrementOfBranch(branch) {
  const named = /(?:^|[/_-])increment[-_]([0-9a-f]{12})(?![0-9a-f])/i.exec(branch ?? "");
  return named === null ? undefined : `increment_${named[1].toLowerCase()}`;
}

export function currentBranch(root, env = process.env) {
  if (env.GITHUB_HEAD_REF) return env.GITHUB_HEAD_REF;
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function branchTree(library, branch) {
  return library.projectTree({ pendingOf: incrementOfBranch(branch) });
}

export function staleProblems(increment, stale) {
  return stale.map(({ record, type, base, moved }) =>
    `${increment}'s pending change to ${type} ${record} was read at history entry ${base}, but entry ${moved.seq} (${moved.action} ${moved.at}${moved.actor === undefined ? "" : ` by ${moved.actor}`}) has changed it since: read it again and write the change again (ADR-0966 D5)`);
}

export function capabilityListFor(root, env = process.env) {
  try {
    const branch = currentBranch(root, env);
    const increment = incrementOfBranch(branch);
    if (increment === undefined) return { run: false, reason: `branch ${branch} names no increment` };
    return { run: true, reason: `${branch} is ${increment}'s` };
  } catch {
    return { run: false, reason: "Git cannot say which branch this is" };
  }
}

export async function capabilitiesOf(root, files, tree, options = {}) {
  const { capabilitiesOfFiles } = await import("@storytree/map/code-survey");
  const owners = await capabilitiesOfFiles(root, files, tree, options);
  return new Map([...owners].map(([file, { capability }]) => [file, capability]));
}

export function unlistedCapabilities(owners, listed, tree) {
  const titles = new Map(tree.stories.flatMap((story) => story.capabilities.map(({ id, title }) => [id, `${story.title} ${title}`])));
  const unlisted = new Map();
  for (const [file, capability] of owners) {
    if (listed.includes(capability)) continue;
    unlisted.set(capability, [...(unlisted.get(capability) ?? []), file]);
  }
  return [...unlisted].map(([capability, files]) => ({ capability, title: titles.get(capability) ?? capability, files }));
}

export async function branchVerdict(library, root, branch, changed, options = {}) {
  const increment = incrementOfBranch(branch);
  const record = await library.get(increment);
  if (record === null || record.type !== "increment") return { missing: true };
  const tree = await branchTree(library, branch);
  const owners = await capabilitiesOf(root, changed, tree, options);
  const stale = staleProblems(increment, (await library.stalePending(increment)) ?? []);
  return { unlisted: unlistedCapabilities(owners, record.fields.capabilities ?? [], tree), checked: owners.size, stale };
}

function workspacePackages(root, rev) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const listed = rev === undefined
    ? git("ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "packages", "apps")
    : git("ls-tree", "-r", "--name-only", "-z", rev, "--", "packages", "apps");
  const names = new Set();
  for (const file of listed.split("\0").filter((each) => /^(packages|apps)\/[^/]+\/package\.json$/.test(each))) {
    try {
      const { name } = JSON.parse(rev === undefined ? readFileSync(path.join(root, file), "utf8") : git("show", `${rev}:${file}`));
      if (typeof name === "string") names.add(name);
    } catch {
    }
  }
  return names;
}

export function importRewritesOnly(root, files, base = "origin/main") {
  const mergeBase = execFileSync("git", ["merge-base", base, "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const before = workspacePackages(root, mergeBase);
  const after = workspacePackages(root);
  const gone = [...before].filter((name) => !after.has(name));
  const born = [...after].filter((name) => !before.has(name));
  if (gone.length === 0 || born.length === 0) return new Set();
  const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const specifier = new RegExp(`(["'\`])(?:${[...gone, ...born].map(escape).join("|")})(?=[/"'\`])`, "g");
  const renamed = (text) => text.replace(specifier, "$1\0renamed");
  const rewrites = new Set();
  for (const file of files) {
    let was, now;
    try {
      was = execFileSync("git", ["show", `${mergeBase}:${file}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      now = readFileSync(path.join(root, file), "utf8");
    } catch {
      continue;
    }
    if (was !== now && renamed(was) === renamed(now)) rewrites.add(file);
  }
  return rewrites;
}

function textReader(root) {
  let base;
  return (file) => {
    try {
      return readFileSync(path.join(root, file), "utf8");
    } catch {
      base ??= execFileSync("git", ["merge-base", "origin/main", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      return execFileSync("git", ["show", `${base}:${file}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    }
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const decision = capabilityListFor(root);
  if (!decision.run) console.log(`not checked: ${decision.reason}`);
  else {
    const branch = currentBranch(root);
    const increment = incrementOfBranch(branch);
    const { changedFiles } = await import("@storytree/base-dev-loop/test-scope");
    const touched = changedFiles(root);
    const rewrites = importRewritesOnly(root, touched);
    const changed = touched.filter((file) => !rewrites.has(file));
    if (rewrites.size > 0) console.log(`${rewrites.size} file${rewrites.size === 1 ? "" : "s"} only rewrite an import of a package this branch renames, so change no capability`);
    const verdict = await withLibrary((library) => branchVerdict(library, root, branch, changed, { readText: textReader(root) }),
      "node --import tsx packages/repo-checks/src/capability-list.mjs");
    if (verdict === undefined) process.exitCode = 1;
    else if (verdict.missing) {
      console.error(`This branch names ${increment}, which is not an increment in the library.`);
      process.exitCode = 1;
    } else {
      if (verdict.stale.length > 0) {
        console.error(`This branch's pending plan changes were written against records that have changed since:\n${verdict.stale.map((problem) => `  ${problem}`).join("\n")}`);
        process.exitCode = 1;
      }
      if (verdict.unlisted.length > 0) {
        const lines = verdict.unlisted.map(({ capability, title, files }) => `  ${title} (${capability}): ${files.join(", ")}`);
        console.error(`This branch changes capabilities ${increment} does not list:\n${lines.join("\n")}\nAdd each to its capabilities list if the increment changes it (\`storytree arc increment edit ${increment} --capabilities …\`, or the edit_plan tool), or take the change out of this branch (ADR-0949 D3).`);
        process.exitCode = 1;
      } else console.log(`every capability this branch changes (${verdict.checked} file${verdict.checked === 1 ? "" : "s"} placed) is on ${increment}'s list`);
    }
  }
}

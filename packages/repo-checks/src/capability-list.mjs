// Capability 4 · Capability-list check. Whether a branch changes only the capabilities its increment lists (ADR-0949 D3): each
// changed file is mapped to its capability by the lookup edit claims share (ADR-0925 D4,
// @storytree/map/code-survey's capabilitiesOfFiles): a file's own declaration (a source file's
// opening "Capability N · <title>", a test file's one numbered capability), else the code survey's
// inference. A file none of these places changes no capability, nor does one whose only change rewrites an
// import of a package the branch renames, so a rename claims no importer's capability. The branch's increment is the one its
// name carries (a workspace's branch is claude/increment-<id>-<suffix>); a branch naming none is not
// checked. It reads the plan with that increment's pending changes laid over, and fails one written
// against a record that has changed since (ADR-0966 D3, D5).
// The library holds the list, so `pnpm gate` runs this as check:capability-list, and CI can
// run it on its own (`node --import tsx packages/repo-checks/src/capability-list.mjs`) where it can reach the library.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { withLibrary } from "./library-reach.mjs";

/** The increment a branch's name carries, as its library id; undefined when it names none. */
export function incrementOfBranch(branch) {
  const named = /(?:^|[/_-])increment[-_]([0-9a-f]{12})(?![0-9a-f])/i.exec(branch ?? "");
  return named === null ? undefined : `increment_${named[1].toLowerCase()}`;
}

/** The branch this checkout is on: CI's pull request head when it gives one, else Git's. */
export function currentBranch(root, env = process.env) {
  if (env.GITHUB_HEAD_REF) return env.GITHUB_HEAD_REF;
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * The plan `branch`'s own checks read (ADR-0966 D3): the library's live plan with the pending changes of
 * the increment its name carries laid over, or the live plan when it names none.
 */
export function branchTree(library, branch) {
  return library.projectTree({ pendingOf: incrementOfBranch(branch) });
}

/**
 * One sentence for each of `increment`'s pending changes written against an older version of its record
 * (ADR-0966 D5), as the library's stalePending gives them; empty when none is.
 */
export function staleProblems(increment, stale) {
  return stale.map(({ record, type, base, moved }) =>
    `${increment}'s pending change to ${type} ${record} was read at history entry ${base}, but entry ${moved.seq} (${moved.action} ${moved.at}${moved.actor === undefined ? "" : ` by ${moved.actor}`}) has changed it since: read it again and write the change again (ADR-0966 D5)`);
}

/** Whether the gate runs the check, and why not when it does not. */
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

/**
 * Which capability each of `files` (repo-relative) belongs to, over `tree` (the library's projectTree()):
 * a Map of file to capability id, without the files that belong to none. It is the map's shared lookup
 * (ADR-0925 D4), so the gate and edit claims never place a file differently; `readText` and `survey`
 * pass through to it.
 */
export async function capabilitiesOf(root, files, tree, options = {}) {
  const { capabilitiesOfFiles } = await import("@storytree/map/code-survey");
  const owners = await capabilitiesOfFiles(root, files, tree, options);
  return new Map([...owners].map(([file, { capability }]) => [file, capability]));
}

/**
 * The capabilities a branch changes that its increment does not list, each with its title and the files
 * that changed it; empty when every one is listed. `owners` maps changed files to capability ids.
 */
export function unlistedCapabilities(owners, listed, tree) {
  const titles = new Map(tree.stories.flatMap((story) => story.capabilities.map(({ id, title }) => [id, `${story.title} ${title}`])));
  const unlisted = new Map();
  for (const [file, capability] of owners) {
    if (listed.includes(capability)) continue;
    unlisted.set(capability, [...(unlisted.get(capability) ?? []), file]);
  }
  return [...unlisted].map(([capability, files]) => ({ capability, title: titles.get(capability) ?? capability, files }));
}

/**
 * The check's verdict on `branch`, whose `changed` files (repo-relative) are under `root`: every read it
 * makes of `library`, which CI makes as its plan-read role (ADR-0952), so each needs that role's grant
 * (infra/library-host/plan-read-grants.sql). `{ missing: true }` when the branch's increment is not one;
 * else the capabilities it changes unlisted, how many files were placed, and its stale pending changes.
 * `options` (readText, survey) pass through to capabilitiesOf.
 */
export async function branchVerdict(library, root, branch, changed, options = {}) {
  const increment = incrementOfBranch(branch);
  const record = await library.get(increment);
  if (record === null || record.type !== "increment") return { missing: true };
  const tree = await branchTree(library, branch);
  const owners = await capabilitiesOf(root, changed, tree, options);
  const stale = staleProblems(increment, (await library.stalePending(increment)) ?? []);
  return { unlisted: unlistedCapabilities(owners, record.fields.capabilities ?? [], tree), checked: owners.size, stale };
}

/** The names the workspace's packages (packages/*, apps/*) declare at commit `rev`, or in the checkout when it is undefined. */
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
      // a manifest deleted from the checkout, or one that does not parse, names no package
    }
  }
  return names;
}

/**
 * Which of `files` (repo-relative, changed since the merge base with `base`) change only by rewriting an
 * import of a package the branch renames: a quoted specifier naming a package declared at the merge base
 * and gone from the checkout, or one the checkout declares that the merge base did not, with the same
 * subpath. Such a file is left out of the check, so renaming a package claims no importer's capability.
 */
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
      continue; // a file the branch adds or deletes is a change of its own
    }
    if (was !== now && renamed(was) === renamed(now)) rewrites.add(file);
  }
  return rewrites;
}

/** A changed file's text: as the checkout has it, or as the branch's base had it when the branch deleted it. */
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

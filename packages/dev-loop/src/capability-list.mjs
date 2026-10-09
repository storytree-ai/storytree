// Capability 7 · The gate. Whether a branch changes only the capabilities its increment lists (ADR-0949 D3): each
// changed file is mapped to its capability by the lookup edit claims share (ADR-0925 D4,
// @storytree/map/code-survey's capabilitiesOfFiles): a file's own declaration (a source file's
// opening "Capability N · <title>", a test file's one numbered capability), else the code survey's
// inference. A file none of these places changes no capability. The branch's increment is the one its
// name carries (a workspace's branch is claude/increment-<id>-<suffix>); a branch naming none is not
// checked. The library holds the list, so `pnpm gate` runs this as check:capability-list, and CI can
// run it on its own (`node --import tsx packages/dev-loop/src/capability-list.mjs`) where it can reach the library.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    const increment = incrementOfBranch(currentBranch(root));
    const { withLibrary } = await import("./build-guidance.mjs");
    const { changedFiles } = await import("./test-scope.mjs");
    const changed = changedFiles(root);
    const verdict = await withLibrary(async (library) => {
      const record = await library.get(increment);
      if (record === null || record.type !== "increment") return { missing: true };
      const tree = await library.projectTree();
      const owners = await capabilitiesOf(root, changed, tree, { readText: textReader(root) });
      return { unlisted: unlistedCapabilities(owners, record.fields.capabilities ?? [], tree), checked: owners.size };
    }, "node --import tsx packages/dev-loop/src/capability-list.mjs");
    if (verdict === undefined) process.exitCode = 1;
    else if (verdict.missing) {
      console.error(`This branch names ${increment}, which is not an increment in the library.`);
      process.exitCode = 1;
    } else if (verdict.unlisted.length > 0) {
      const lines = verdict.unlisted.map(({ capability, title, files }) => `  ${title} (${capability}): ${files.join(", ")}`);
      console.error(`This branch changes capabilities ${increment} does not list:\n${lines.join("\n")}\nAdd each to its capabilities list if the increment changes it (\`storytree arc increment edit ${increment} --capabilities …\`, or the edit_plan tool), or take the change out of this branch (ADR-0949 D3).`);
      process.exitCode = 1;
    } else console.log(`every capability this branch changes (${verdict.checked} file${verdict.checked === 1 ? "" : "s"} placed) is on ${increment}'s list`);
  }
}

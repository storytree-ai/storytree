// Capability 8 · Storytree's own test and gate entries. check:mounted-parts (contract 8.15): a branch's new dependency
// edge can stand a part on one this computer switches off, which takes the whole part off here (the Mint box switches
// agent-pool off, so a part that newly depends on it loses every command it adds), and neither a review nor the scoped
// tests see it. This reads the workspace's parts graph at merge-base(origin/main, HEAD) and in the working tree, by the
// plugin loader's own rule (partsGraphOf), and fails naming each part mounted on the first that the switched-off parts
// this computer records take off on the second, with the new edge that took it off. It reads the computer's settings,
// so CI, which switches nothing off, does not run it: `pnpm gate` does, where parts are switched off.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { partsGraphOf, switchedOff } from "@storytree/plugin-loader";
import { readPartsOff } from "@storytree/project-and-caller";

const FOLDERS = ["packages", "apps"];
const gitOut = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Every workspace package's package.json, by name: at `ref`, or in the working tree when none is given. */
function workspacePackages(root, ref) {
  const files = ref === undefined
    ? FOLDERS.flatMap((folder) => existsSync(path.join(root, folder)) ? readdirSync(path.join(root, folder)).map((name) => `${folder}/${name}/package.json`) : [])
      .filter((file) => existsSync(path.join(root, file)))
    : gitOut(root, "ls-tree", "-r", "--name-only", ref, "--", ...FOLDERS).split("\n").filter((file) => /^(packages|apps)\/[^/]+\/package\.json$/.test(file));
  const packages = new Map();
  for (const file of files) {
    const pkg = JSON.parse(ref === undefined ? readFileSync(path.join(root, file), "utf8") : gitOut(root, "show", `${ref}:${file}`));
    if (typeof pkg.name === "string") packages.set(pkg.name, pkg);
  }
  return packages;
}

/** The parts graph of every workspace package, as a host depending on all of them would draw it. */
function graphOf(packages) {
  return partsGraphOf([...packages.keys()].sort(), "", (name) => packages.has(name) ? { pkg: packages.get(name), dir: "" } : undefined);
}

/** Whether the step runs: only where this computer switches a part off and origin/main can be read, else why not. */
export function mountedPartsFor({ root }, partsOff = readPartsOff) {
  const off = partsOff();
  if (off.length === 0) return { run: false, reason: "this computer switches no part off" };
  try {
    gitOut(root, "merge-base", "origin/main", "HEAD");
  } catch {
    return { run: false, reason: "Git cannot read origin/main" };
  }
  return { run: true, reason: `this computer switches off ${off.join(", ")}` };
}

/**
 * One sentence for each part mounted on merge-base(origin/main, HEAD)'s parts graph that `off` takes off in the working
 * tree's, naming the first edge new on the branch along its way to the switched-off part; empty when none is.
 */
export function unmountedParts(root, off) {
  const main = graphOf(workspacePackages(root, gitOut(root, "merge-base", "origin/main", "HEAD").trim()));
  const branch = graphOf(workspacePackages(root));
  const offOnMain = switchedOff(main, off);
  const offOnBranch = switchedOff(branch, off);
  const problems = [];
  for (const [part, because] of offOnBranch) {
    if (!Object.hasOwn(main, part) || offOnMain.has(part)) continue;
    const edge = newEdge(main, branch, offOnBranch, part, because);
    problems.push(`${part} mounts on origin/main but is switched off here on this branch: its new edge ${edge.join(" → ")} stands it on ${because}, which this computer switches off`);
  }
  return problems;
}

/** The first edge on the branch graph's shortest way from `part` to `because`, through switched-off parts, that origin/main's graph lacks. */
function newEdge(main, branch, off, part, because) {
  const before = new Map([[part, undefined]]);
  for (const queue = [part]; queue.length > 0 && !before.has(because);) {
    const at = queue.shift();
    for (const next of branch[at] ?? []) {
      if (before.has(next) || !off.has(next)) continue;
      before.set(next, at);
      queue.push(next);
    }
  }
  const way = [because];
  while (before.get(way[0]) !== undefined) way.unshift(before.get(way[0]));
  // A way wholly on origin/main's graph would take the part off there too, so one of its edges is new.
  return way.slice(1).map((to, index) => [way[index], to]).find(([from, to]) => !(main[from] ?? []).includes(to));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const problems = unmountedParts(root, readPartsOff());
  for (const problem of problems) console.error(`check:mounted-parts: ${problem}`);
  if (problems.length === 0) console.log("check:mounted-parts: every part mounted on origin/main mounts on this branch");
  process.exitCode = problems.length === 0 ? 0 : 1;
}

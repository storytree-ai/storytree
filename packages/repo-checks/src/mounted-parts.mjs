// Capability 8 · Storytree's own test and gate entries
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { partsGraphOf, switchedOff } from "@storytree/plugin-loader";
import { readPartsOff } from "@storytree/project-and-caller";

const FOLDERS = ["packages", "apps"];
const gitOut = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

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

function graphOf(packages) {
  return partsGraphOf([...packages.keys()].sort(), "", (name) => packages.has(name) ? { pkg: packages.get(name), dir: "" } : undefined);
}

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
  return way.slice(1).map((to, index) => [way[index], to]).find(([from, to]) => !(main[from] ?? []).includes(to));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const problems = unmountedParts(root, readPartsOff());
  for (const problem of problems) console.error(`check:mounted-parts: ${problem}`);
  if (problems.length === 0) console.log("check:mounted-parts: every part mounted on origin/main mounts on this branch");
  process.exitCode = problems.length === 0 ? 0 : 1;
}

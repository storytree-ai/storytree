// Capability 10 · Evidence recordings follow their arc. A recording made as evidence (a .webm clip, a V8
// trace or coverage .json.gz under an evidence folder) lives as long as its arc (ADR-1123 D1): once every
// arc it was made for has closed and nothing active names it, it leaves main, and its folder's README
// links its last copy by commit (D2: history is kept). Each tracked recording is mapped through the
// commits that added or changed it to the pull requests that merged them into main, their branches and
// increments (the increment a branch's name carries, else the one whose close names the pull request),
// and those increments' arcs. It stays when any of those arcs is not closed, when it maps to no pull
// request or increment, when an increment on an arc that is not closed names it or its folder, and when
// a source file outside the evidence folders names it, since a build or test reads it then (D3; a
// seed.json.gz is always an input). `pnpm evidence:sweep` lists what goes and what stays, and why;
// `--apply` deletes what goes and stages it with the READMEs, ready to commit. The session manager's
// routine runs it and parks an increment to land what it lists.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { incrementOfBranch } from "./capability-list.mjs";

/** A recording: a clip, trace or coverage file under a folder named evidence, never a seed a capture reads. */
export function isRecording(file) {
  return /(^|\/)evidence\/(.+\/)?[^/]+\.(webm|json\.gz)$/.test(file) && path.posix.basename(file) !== "seed.json.gz";
}

/** Source a build or test runs, outside every evidence folder (the folder's name kept out of the glob's text, which the test scope reads as naming every evidence script). */
const EVIDENCE = "evidence";
const SOURCES = ["*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.mjs", "*.cjs", `:(exclude,glob)**/${EVIDENCE}/**`];

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

const lines = (text) => text.split("\n").filter((line) => line !== "");

/** The pull requests (number and branch) that merged each of `file`'s commits into `head`'s main line, oldest first. */
function pullRequestsOf(root, file, head) {
  const found = new Map();
  for (const commit of lines(git(root, ["log", "--format=%H", head, "--", file]))) {
    const merges = lines(git(root, ["log", "--ancestry-path", "--merges", "--format=%s", `${commit}..${head}`]))
      .map((subject) => /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/.exec(subject))
      .filter((merge) => merge !== null);
    const merged = merges.at(-1);
    if (merged !== undefined) found.set(merged[1], { pr: merged[1], branch: merged[2] });
  }
  return [...found.values()];
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The first source file at `head` naming the recording `file`, if any does: its name quoted whole, or
 * after its own folder's name (a same-named file in another folder is not it).
 */
function readerOf(root, head, file) {
  const name = path.posix.basename(file);
  const folder = path.posix.basename(path.posix.dirname(file));
  let hits;
  try {
    hits = lines(git(root, ["grep", "-l", "-F", "-e", name, head, "--", ...SOURCES]));
  } catch (error) {
    if (error.status === 1) return undefined;
    throw error;
  }
  const named = new RegExp(`(?:(?:^|[^\\w.-])${escaped(folder)}/|["'\`])${escaped(name)}(?![\\w.-])`);
  return hits.map((hit) => hit.slice(head.length + 1)).sort().find((source) => named.test(git(root, ["show", `${head}:${source}`])));
}

const prOf = (ref) => /^#?(\d+)$/.exec(String(ref ?? "").trim())?.[1];

/**
 * What a sweep of `root`'s recordings at `head` would do, over `arcs` (the library's arcViews: each arc with
 * its state and increments): `go`, each recording to delete with its arcs and pull requests, and `keep`,
 * each recording that stays with why. Both in path order.
 */
export function sweepPlan(root, arcs, { head = "HEAD" } = {}) {
  const tracked = lines(git(root, ["ls-tree", "-r", "--name-only", head]));
  const arcOf = new Map();
  const byPr = new Map();
  const naming = [];
  for (const view of arcs) {
    for (const increment of view.increments) {
      arcOf.set(increment.id, view);
      const pr = prOf(increment.fields.outcome?.pr);
      if (pr !== undefined) byPr.set(pr, [...(byPr.get(pr) ?? []), increment.id]);
      if (view.state !== "closed") {
        const { title, objective, body } = increment.fields;
        naming.push({ id: increment.id, text: [title, objective, body].filter((part) => typeof part === "string").join("\n") });
      }
    }
  }
  const go = [];
  const keep = [];
  for (const file of tracked.filter(isRecording).sort()) {
    const reader = readerOf(root, head, file);
    if (reader !== undefined) {
      keep.push({ file, why: `${reader} reads it` });
      continue;
    }
    const prs = pullRequestsOf(root, file, head);
    if (prs.length === 0) {
      keep.push({ file, why: "no pull request merged it, so no arc can be read" });
      continue;
    }
    const increments = new Set();
    const unmapped = [];
    for (const { pr, branch } of prs) {
      const ids = [incrementOfBranch(branch), ...(byPr.get(pr) ?? [])].filter((id) => id !== undefined && arcOf.has(id));
      if (ids.length === 0) unmapped.push(`#${pr}`);
      for (const id of ids) increments.add(id);
    }
    if (unmapped.length > 0) {
      keep.push({ file, why: `no increment is known for ${unmapped.join(", ")}` });
      continue;
    }
    const views = [...new Set([...increments].map((id) => arcOf.get(id)))];
    const open = views.filter((view) => view.state !== "closed");
    if (open.length > 0) {
      keep.push({ file, why: open.map((view) => `${view.arc.id} is ${view.state}`).join(", ") });
      continue;
    }
    const namer = naming.find((one) => one.text.includes(file) || one.text.includes(path.posix.dirname(file)));
    if (namer !== undefined) {
      keep.push({ file, why: `${namer.id} names it` });
      continue;
    }
    go.push({ file, arcs: views.map((view) => view.arc.id).sort(), prs: prs.map((one) => one.pr) });
  }
  return { go, keep };
}

/**
 * Delete `plan`'s recordings from `root` and give each folder's README a link to every one's last copy at
 * `commit` in `repository` (its GitHub address), rewriting a link the README already had to it; the
 * deletions and READMEs are staged.
 */
export function applySweep(root, plan, { commit, date, repository }) {
  const byFolder = new Map();
  for (const { file } of plan.go) byFolder.set(path.posix.dirname(file), [...(byFolder.get(path.posix.dirname(file)) ?? []), file]);
  for (const [folder, files] of byFolder) {
    const readme = path.posix.join(folder, "README.md");
    let text = existsSync(path.join(root, readme)) ? readFileSync(path.join(root, readme), "utf8") : `# ${path.posix.basename(folder)}\n`;
    const link = (file) => `${repository}/blob/${commit}/${file}`;
    for (const file of files) {
      text = text.replace(new RegExp(`\\]\\((\\./)?${escaped(path.posix.basename(file))}\\)`, "g"), `](${link(file)})`);
    }
    const listed = files.map((file) => `[${path.posix.basename(file)}](${link(file)})`).join(", ");
    text = `${text.trimEnd()}\n\nRemoved from \`main\` on ${date}, its arc closed (ADR-1123): ${listed}. Each link is its last copy, kept in git history.\n`;
    writeFileSync(path.join(root, readme), text);
    git(root, ["rm", "-q", "--", ...files]);
    git(root, ["add", "--", readme]);
  }
}

/** The repository's GitHub address, from its origin remote. */
function repositoryOf(root) {
  const url = git(root, ["remote", "get-url", "origin"]).trim();
  return url.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const apply = process.argv.includes("--apply");
  const { withLibrary } = await import("./build-guidance.mjs");
  const arcs = await withLibrary((library) => library.arcViews(), "pnpm evidence:sweep");
  if (arcs === undefined) process.exit(1);
  const plan = sweepPlan(root, arcs);
  for (const { file, why } of plan.keep) console.log(`keep  ${file}  (${why})`);
  for (const { file, arcs: closed, prs } of plan.go) console.log(`go    ${file}  (${closed.join(", ")} closed; ${prs.map((pr) => `#${pr}`).join(" ")})`);
  console.log(`${plan.go.length} recording${plan.go.length === 1 ? "" : "s"} can leave main, ${plan.keep.length} stay.`);
  if (apply && plan.go.length > 0) {
    const commit = git(root, ["rev-parse", "HEAD"]).trim();
    applySweep(root, plan, { commit, date: new Date().toISOString().slice(0, 10), repository: repositoryOf(root) });
    console.log(`Deleted and staged them, each linked from its folder's README at ${commit.slice(0, 8)}: commit and open a pull request.`);
  }
}

// Capability 11 · Carrying the repository to a new one. The new repo's single starting commit (arc_824a506f2125,
// runbook process_761459dc626c): `build` takes a ref's tree (origin/main by default) into a scratch repository
// outside the checkout and commits it there as an orphan, a commit with no parent, so none of the old history
// comes with it; it is never pushed by this script. Option a keeps every file; option b, the owner's answer to
// question_fdd1a223ed0d, leaves the evidence folders out, except each evidence set (an evidence folder's first
// folder or file) a file outside the evidence folders names in its code, workflows or package manifests, which a test or the website's replay reads until it
// moves into a scrubbed set of its own. The commit is then read by the tree-wide leak scan (leak-scan.mjs).
//
//   node packages/dev-loop/src/starting-tree.mjs --option a|b [--ref origin/main] [--out <empty folder>]

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isThirdParty, leakReport, libraryWords, OWNER_WORDS, scanTree, trackedFiles } from "@storytree/repo-checks/leak-scan";

const git = (cwd, args, input, env) => execFileSync("git", args, { cwd, encoding: "utf8", input, env, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });

/** The evidence set a file belongs to (`<folder>/evidence/<first part>`), or undefined outside every evidence folder. */
export function evidenceSet(file) {
  const match = /^(.*?(?:^|\/)evidence)\/([^/]+)/.exec(file);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/**
 * The evidence sets a file outside the evidence folders names: by its whole path, or, from inside the folder that
 * holds the evidence folder, as `evidence/<set>`. `textOf(file)` reads a file at the ref.
 */
export function readSets(files, textOf) {
  const sets = new Set(files.map(evidenceSet).filter(Boolean));
  const read = new Set();
  for (const file of files) {
    if (evidenceSet(file) !== undefined || isThirdParty(file)) continue;
    const text = textOf(file);
    if (!text.includes("evidence/")) continue;
    for (const set of sets) {
      if (read.has(set)) continue;
      const owner = set.slice(0, set.lastIndexOf("/evidence/"));
      if (text.includes(set) || (file.startsWith(`${owner}/`) && text.includes(set.slice(owner.length + 1)))) read.add(set);
    }
  }
  return [...read].sort();
}

/** A file that can read evidence when a build or test runs: code, a workflow or a package manifest (a document's link reads nothing). */
const READER = /(?:\.(?:[cm]?[jt]sx?|sh|ps1)|^\.github\/workflows\/.+\.ya?ml|(?:^|\/)package\.json)$/;

/** The files at `ref` the option keeps, with their sizes, and the evidence sets option b keeps because something reads them. */
export function startingFiles(root, ref, option) {
  const files = git(root, ["ls-tree", "-r", "-l", "-z", ref]).split("\0").filter(Boolean).map((line) => {
    const [meta, file] = line.split("\t");
    const size = meta.trim().split(/\s+/)[3];
    return { file, size: size === "-" ? 0 : Number(size) };
  });
  if (option === "a") return { files, kept: [] };
  const textOf = (file) => {
    try {
      return git(root, ["show", `${ref}:${file}`]);
    } catch {
      return "";
    }
  };
  const textFiles = files.filter(({ file, size }) => size < 4 * 1024 * 1024 && READER.test(file)).map(({ file }) => file);
  const kept = readSets([...textFiles, ...files.filter(({ file }) => evidenceSet(file) !== undefined).map(({ file }) => file)], textOf);
  return { files: files.filter(({ file }) => evidenceSet(file) === undefined || kept.includes(evidenceSet(file))), kept };
}

/** Builds the starting commit in `out` (an empty folder): an orphan holding `ref`'s tree as the option keeps it. */
export function buildStartingCommit({ root, ref = "origin/main", option, out, message = "storytree" }) {
  if (option !== "a" && option !== "b") throw new Error(`--option must be a or b, not ${option}`);
  if (existsSync(out) && readdirSync(out).length > 0) throw new Error(`${out} is not empty`);
  const commit = git(root, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  const { files, kept } = startingFiles(root, commit, option);
  git(root, ["init", "-q", out]);
  git(out, ["fetch", "-q", "--depth", "1", pathToFileURL(root).href, commit]);
  git(out, ["read-tree", commit]);
  const keep = new Set(files.map(({ file }) => file));
  const dropped = git(out, ["ls-files", "-z"]).split("\0").filter((file) => file !== "" && !keep.has(file));
  if (dropped.length > 0) git(out, ["rm", "-q", "--cached", "--pathspec-from-file=-", "--pathspec-file-nul"], `${dropped.join("\0")}\0`);
  const tree = git(out, ["write-tree"]).trim();
  // The scratch repository has no identity of its own: the commit is made as the checkout's.
  const [name, email] = ["user.name", "user.email"].map((key) => git(root, ["config", key]).trim());
  const identity = { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  const start = git(out, ["commit-tree", tree, "-m", message], undefined, identity).trim();
  git(out, ["update-ref", "refs/heads/main", start]);
  git(out, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  git(out, ["checkout", "-q", "-f", "main"]);
  git(out, ["reflog", "expire", "--expire=now", "--all"]);
  git(out, ["gc", "-q", "--prune=now"]);
  return { commit: start, from: commit, files: files.length, bytes: files.reduce((total, { size }) => total + size, 0), kept };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  try {
    const out = path.resolve(flag("--out", mkdtempSync(path.join(tmpdir(), "storytree-start-"))));
    const built = buildStartingCommit({ root, ref: flag("--ref", "origin/main"), option: flag("--option"), out });
    console.log(`starting commit ${built.commit} (no parent) in ${out}, from ${built.from}: ${built.files} files, ${(built.bytes / 1e6).toFixed(1)} MB`);
    if (built.kept.length > 0) console.log(`evidence sets kept because a file outside the evidence folders reads them (${built.kept.length}):\n${built.kept.map((set) => `  ${set}`).join("\n")}`);
    const read = await libraryWords(root);
    if (read.words === undefined) console.log(`Note: private names not checked: ${read.why}.`);
    const found = scanTree(out, trackedFiles(out), [...OWNER_WORDS, ...(read.words ?? [])]);
    console.log(`\n${leakReport(found)}`);
    if (found.length > 0) process.exitCode = 1;
  } catch (error) {
    console.error(`starting-tree: ${error.message}`);
    process.exitCode = 1;
  }
}

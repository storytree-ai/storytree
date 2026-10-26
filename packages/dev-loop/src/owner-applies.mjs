// Capability 7 · The gate. check:owner-applies (increment_0269b5e07872, friction_a4217c1f48fa): a branch that changes
// a folder the owner applies by hand fails the gate unless an open increment waits on the owner with a note naming
// that folder, so main and the live cloud never drift apart with nothing telling him to apply it. OWNER_APPLIED is the
// one list of those folders; a folder whose README says the owner applies it is added here. A change to a folder's
// Markdown alone needs no apply. The waits are read from the library, which CI cannot, so only the gate runs it.

import { fileURLToPath, pathToFileURL } from "node:url";

import { changedFiles } from "./test-scope.mjs";

/** The folders the owner applies by hand, repo-relative. */
export const OWNER_APPLIED = ["infra/ci-health", "infra/website-publish"];

/** The owner-applied folders `files` (repo-relative) change, each with its changed files; Markdown is left out. */
export function ownerAppliedChanges(files) {
  const changes = [];
  for (const folder of OWNER_APPLIED) {
    const inside = files.filter((file) => file.startsWith(`${folder}/`) && !file.endsWith(".md"));
    if (inside.length > 0) changes.push({ folder, files: inside });
  }
  return changes;
}

/**
 * The `changes` (as ownerAppliedChanges gives them) no owner wait names: `waitsFor` is the library's holds().waitsFor,
 * each open increment's waits for the owner or an event keyed by its id. A holding owner wait whose note names the
 * folder covers it; an event wait does not.
 */
export function unwaitedApplies(changes, waitsFor) {
  const notes = Object.values(waitsFor ?? {}).flat().filter(({ releaser, holds }) => releaser === "owner" && holds).map(({ note }) => note);
  return changes.filter(({ folder }) => !notes.some((note) => note.includes(folder)));
}

/** Whether the gate runs the check: only when the branch changes an owner-applied folder, or Git cannot say. */
export function ownerAppliesFor(root) {
  try {
    const changes = ownerAppliedChanges(changedFiles(root));
    if (changes.length === 0) return { run: false, reason: "no owner-applied infra folder changed" };
    return { run: true, reason: `${changes.map(({ folder }) => folder).join(", ")} changed` };
  } catch {
    return { run: true, reason: "Git cannot say what this branch changes; checking conservatively" };
  }
}

/**
 * What the check prints and its exit code: `changes` as ownerAppliedChanges gives them (undefined when Git cannot say),
 * and `missing` as unwaitedApplies gives them (undefined when the library could not be read, which says why itself).
 */
export function ownerAppliesReport(changes, missing) {
  if (changes === undefined) return { code: 1, error: "Git cannot say what this branch changes, so whether it changes an owner-applied folder cannot be checked." };
  if (changes.length === 0) return { code: 0, text: "this branch changes no owner-applied infra folder" };
  if (missing === undefined) return { code: 1 };
  if (missing.length === 0) return { code: 0, text: `an owner wait names each owner-applied folder this branch changes (${changes.map(({ folder }) => folder).join(", ")})` };
  const lines = missing.map(({ folder, files }) => `  ${folder}: ${files.join(", ")}`);
  return { code: 1, error: `This branch changes folders the owner applies by hand, and no owner wait names them:\n${lines.join("\n")}\nPark an owner-action increment born waiting on him, its note naming the folder, this branch and the plan to run, for example:\n  pnpm storytree arc increment new --arc <arc> --title "Apply ${missing[0].folder}" --objective "main and the live cloud agree" --body @apply.txt --wait-for owner --wait-note "After <branch> merges, apply ${missing[0].folder}: terraform plan, then apply"\nThen run the gate again.` };
}

/**
 * Run the check on the checkout at `root` and say its verdict through `log` and `error`, returning its exit code.
 * `withWaits(read)` hands `read` the open increments' waits for the owner or an event (holds().waitsFor), or gives
 * undefined when the library cannot be read; it is called only when the branch changes an owner-applied folder.
 */
export async function checkOwnerApplies(root, withWaits, { log = console.log, error = console.error } = {}) {
  let changes;
  try {
    changes = ownerAppliedChanges(changedFiles(root));
  } catch {} // Git cannot say what this branch changes: the report says so
  const missing = changes?.length > 0 ? await withWaits((waitsFor) => unwaitedApplies(changes, waitsFor)) : [];
  const report = ownerAppliesReport(changes, missing);
  if (report.text !== undefined) log(report.text);
  if (report.error !== undefined) error(report.error);
  return report.code;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { withLibrary } = await import("./build-guidance.mjs");
  const withWaits = (read) => withLibrary(async (library) => read((await library.holds()).waitsFor), "pnpm gate");
  process.exitCode = await checkOwnerApplies(fileURLToPath(new URL("../../..", import.meta.url)), withWaits);
}

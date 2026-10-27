/**
 * Capability 1 · Project libraries. Whether the project schema this code would apply is on main
 * (contract 1.29): a shared library takes schema statements only from merged code, so a branch
 * later rejected or reverted never leaves its tables, or its schema version, on the live library.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Whether the schema file is merged, and when it is not, why, in words for a warning. */
export type SchemaMerged = { readonly merged: true } | { readonly merged: false; readonly why: string };

/**
 * Read the schema file's standing in its checkout. Code outside a git checkout, or a bundle with no
 * schema file on disk, or one built into a folder its checkout ignores, is released code, so merged. In a checkout, the file is merged when it has no
 * uncommitted change and the last commit that changed it is on the locally fetched origin/main (so a
 * branch behind main, or one that merged main after editing the file, reads as it truly stands). An
 * unreadable origin/main is not merged, said so. These bounded local reads never fetch or change the checkout.
 */
export function schemaMerged(schemaFile: string): SchemaMerged {
  if (!existsSync(schemaFile)) return { merged: true };
  const git = (...args: string[]): string => execFileSync("git", ["-C", path.dirname(schemaFile), ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 2_000,
  }).trim();
  const file = path.basename(schemaFile);
  try {
    git("rev-parse", "--show-toplevel");
  } catch {
    return { merged: true };
  }
  try {
    git("check-ignore", "--quiet", "--no-index", "--", file);
    return { merged: true };
  } catch {
    // not ignored: a source file, read below
  }
  try {
    git("ls-files", "--error-unmatch", "--", file);
  } catch {
    return { merged: false, why: `${file} is not committed in its checkout` };
  }
  if (git("status", "--porcelain", "--", file) !== "") return { merged: false, why: `${file} has uncommitted changes` };
  let main: string;
  try {
    main = git("rev-parse", "--verify", "--quiet", "origin/main^{commit}");
  } catch {
    return { merged: false, why: "origin/main cannot be read in its checkout" };
  }
  const last = git("rev-list", "-1", "HEAD", "--", file);
  if (last === "") return { merged: false, why: `${file} has no commit on this branch` };
  try {
    git("merge-base", "--is-ancestor", last, main);
    return { merged: true };
  } catch {
    return { merged: false, why: `${file}'s last change (${last.slice(0, 12)}) is not on origin/main` };
  }
}

// Capability 1 · Opening a project
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type SchemaMerged = { readonly merged: true } | { readonly merged: false; readonly why: string };

export function schemaMerged(schemaFile: string): SchemaMerged {
  if (!existsSync(schemaFile)) return { merged: true };
  const git = (...args: string[]): string => execFileSync("git", ["-C", path.dirname(schemaFile), ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 2_000, windowsHide: true,
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

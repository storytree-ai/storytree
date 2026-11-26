// Capability 1 · Project libraries
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type SchemaStanding = { readonly merged: true } | { readonly merged: false; readonly why: string };

const MERGED: SchemaStanding = { merged: true };

export function schemaMerged(file: string): SchemaStanding {
  if (!existsSync(file)) return MERGED;
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", path.dirname(file), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const succeeds = (...args: string[]): boolean => {
    try {
      git(...args);
      return true;
    } catch {
      return false;
    }
  };
  if (!succeeds("rev-parse", "--is-inside-work-tree")) return MERGED;
  if (succeeds("check-ignore", "-q", file)) return MERGED;
  const name = path.basename(file);
  const status = git("status", "--porcelain", "--", file);
  if (status.startsWith("??")) return { merged: false, why: `${name} is not committed` };
  if (status !== "") return { merged: false, why: `${name} has uncommitted changes` };
  let last = "";
  try {
    last = git("log", "-1", "--format=%H", "--", file);
  } catch {
    last = "";
  }
  if (last === "") return { merged: false, why: `${name} is not committed` };
  if (!succeeds("rev-parse", "--verify", "--quiet", "refs/remotes/origin/main")) {
    return { merged: false, why: `origin/main cannot be read, so whether ${name}'s last change is merged is unknown` };
  }
  if (!succeeds("merge-base", "--is-ancestor", last, "refs/remotes/origin/main")) {
    return { merged: false, why: `${name}'s last change (${last.slice(0, 12)}) is not on origin/main` };
  }
  return MERGED;
}

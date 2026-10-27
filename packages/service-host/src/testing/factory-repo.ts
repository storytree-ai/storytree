/**
 * Capability 4 · Keeping the factory current. The tests' throwaway factory repository: a bare origin, an author's clone
 * that commits and pushes to its main, and the machine's factory clone the host pulls into.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import { removeTemp } from "@storytree/test-waits";

/** Git in `dir`, its trimmed output; commits are made as a test author. */
export const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", ["-C", dir, "-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export interface FactoryRepo {
  /** The machine's factory clone, on main. */
  readonly clone: string;
  /** Commit `files` (a path to its text, or to null to delete it) on origin's main, as another machine would; returns the commit. */
  push(files: Record<string, string | null>, message?: string): string;
}

/** A factory repository whose main holds `files`, cloned into `<under>/factory` (a fresh temporary folder when none). */
export function factoryRepo(t: TestContext, files: Record<string, string>, under?: string): FactoryRepo {
  const root = under ?? realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-factory-")));
  if (under === undefined) t.after(() => removeTemp(root));
  const origin = path.join(root, "origin.git");
  const author = path.join(root, "author");
  const clone = path.join(root, "factory");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", author]);
  git(author, "remote", "add", "origin", origin);
  const push = (changes: Record<string, string | null>, message = "a change"): string => {
    for (const [file, text] of Object.entries(changes)) {
      const full = path.join(author, file);
      if (text === null) rmSync(full);
      else {
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, text);
      }
    }
    git(author, "add", "-A");
    git(author, "commit", "-q", "-m", message);
    git(author, "push", "-q", "origin", "main");
    return git(author, "rev-parse", "HEAD");
  };
  push({ ".gitignore": "node_modules/\n", "pnpm-lock.yaml": "lockfileVersion: '9.0'\n", ...files }, "the factory");
  execFileSync("git", ["clone", "-q", origin, clone]);
  return { clone, push };
}

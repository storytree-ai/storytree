// Capability 4 · Keeping the factory current
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import { removeTemp } from "@storytree/test-waits";

export const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", ["-C", dir, "-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export interface FactoryRepo {
  readonly clone: string;
  push(files: Record<string, string | null>, message?: string): string;
}

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
  execFileSync("git", ["clone", "-q", "--", origin, clone]);
  return { clone, push };
}

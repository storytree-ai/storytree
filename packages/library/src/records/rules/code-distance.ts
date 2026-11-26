// Capability 3 · Record rules
import { execFileSync } from "node:child_process";
import path from "node:path";

export function codeDistance(sourceFile: string): () => number | undefined {
  const git = (...args: string[]): string => execFileSync("git", ["-C", path.dirname(sourceFile), ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 1_000, windowsHide: true,
  }).trim();
  let revision: string;
  try {
    git("ls-files", "--error-unmatch", "--", path.basename(sourceFile));
    revision = git("rev-parse", "HEAD");
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      if (git("rev-parse", "--is-shallow-repository") !== "false") return undefined;
      const count = git("rev-list", "--count", `${revision}..origin/main`, "--");
      return /^\d+$/.test(count) && Number.isSafeInteger(Number(count)) ? Number(count) : undefined;
    } catch {
      return undefined;
    }
  };
}

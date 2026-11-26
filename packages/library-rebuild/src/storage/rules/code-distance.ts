// Capability 3 · Data schema
import { execFileSync } from "node:child_process";
import path from "node:path";

export function codeDistance(source: string): () => number | undefined {
  const folder = path.dirname(source);
  const git = (...args: string[]): string | undefined => {
    try {
      return execFileSync("git", ["-C", folder, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return undefined;
    }
  };
  const loaded = git("ls-files", "--error-unmatch", "--", path.basename(source)) === undefined ? undefined : git("rev-parse", "HEAD");
  return () => {
    if (loaded === undefined) return undefined;
    const count = git("rev-list", "--count", `${loaded}..refs/remotes/origin/main`);
    return count === undefined ? undefined : Number(count);
  };
}

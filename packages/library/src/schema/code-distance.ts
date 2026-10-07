/** Capability 3 · Data schema. */
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Capture the revision when source is loaded, then compare it with the locally fetched main on
 * each refusal. Updating a checkout does not update code already loaded by a long-running server.
 * A bundle outside source control has no known revision, even inside somebody else's checkout.
 * These bounded local reads never fetch, change a checkout, or replace the original schema error.
 */
export function codeDistance(sourceFile: string): () => number | undefined {
  const git = (...args: string[]): string => execFileSync("git", ["-C", path.dirname(sourceFile), ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 1_000,
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

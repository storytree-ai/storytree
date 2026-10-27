/**
 * Capability 4 · Keeping the factory current, contract 4.4 (ADR-1180 D3). The version of the host's own code: the
 * storytree checkout's committed trees of the host's package and every workspace package it stands on (the built-in
 * parts whose services it runs among them), with the lockfile, as the pool dispatcher reads its own (queue.mjs's
 * codeVersion). It changes when HEAD brings a change to any of them, and to nothing else in the checkout.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

// realpathSync.native, not the JS one: on Windows it expands 8.3 short names (RUNNER~1) to the long form git prints.
/** The folders of `hostDir` and the workspace packages it depends on, walked through its installed links, inside `top`. */
function ownFolders(hostDir: string, top: string): string[] {
  const seen = new Set<string>();
  const visit = (dir: string): void => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      let found: string;
      try {
        found = realpathSync.native(path.join(dir, "node_modules", name));
      } catch {
        continue;
      }
      const inside = path.relative(top, found);
      // A package from the registry resolves into the store, under node_modules: only the checkout's own are the host's code.
      if (inside.startsWith("..") || path.isAbsolute(inside) || inside.split(path.sep).includes("node_modules")) continue;
      visit(found);
    }
  };
  visit(realpathSync.native(hostDir));
  return [...seen].map((dir) => path.relative(top, dir).split(path.sep).join("/")).sort();
}

/** The version of the host's own code at `hostDir`'s checkout HEAD, or none when it is not in a git checkout. */
export function ownCodeVersion(hostDir: string): string | undefined {
  try {
    const top = realpathSync.native(git(hostDir, "rev-parse", "--show-toplevel"));
    const listed = git(top, "ls-tree", "HEAD", "--", "pnpm-lock.yaml", ...ownFolders(hostDir, top));
    return listed === "" ? undefined : createHash("sha1").update(listed).digest("hex").slice(0, 12);
  } catch {
    return undefined;
  }
}

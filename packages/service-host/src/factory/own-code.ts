// Capability 4 · Keeping the factory current
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

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
      if (inside.startsWith("..") || path.isAbsolute(inside) || inside.split(path.sep).includes("node_modules")) continue;
      visit(found);
    }
  };
  visit(realpathSync.native(hostDir));
  return [...seen].map((dir) => path.relative(top, dir).split(path.sep).join("/")).sort();
}

export function ownCodeVersion(hostDir: string): string | undefined {
  try {
    const top = realpathSync.native(git(hostDir, "rev-parse", "--show-toplevel"));
    const listed = git(top, "ls-tree", "HEAD", "--", "pnpm-lock.yaml", ...ownFolders(hostDir, top));
    return listed === "" ? undefined : createHash("sha1").update(listed).digest("hex").slice(0, 12);
  } catch {
    return undefined;
  }
}

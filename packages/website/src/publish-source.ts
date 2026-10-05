import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface CheckedRun {
  conclusion: string | null;
  event: string;
  head_sha: string;
  head_branch: string;
  head_repository: { full_name: string } | null;
}

export interface MergedPullRequest {
  merged: boolean;
  merge_commit_sha: string | null;
  head: { sha: string; repo: { full_name: string } | null };
  base: { ref: string };
}

export const REPOSITORY = "storytree-ai/storytree";

/** Contract 4.3: accept verified main pushes, direct PR merges and queue commits confirmed merged. */
export function publicationSource(run: CheckedRun, pr?: MergedPullRequest): string | undefined {
  if (run.conclusion !== "success" || run.head_repository?.full_name !== REPOSITORY) return undefined;
  let sha: string | null | undefined;
  if (run.event === "push" && run.head_branch === "main") sha = run.head_sha;
  if (run.event === "pull_request" && pr?.merged && pr.base.ref === "main" &&
      pr.head.repo?.full_name === REPOSITORY && pr.head.sha === run.head_sha) sha = pr.merge_commit_sha;
  if (run.event === "merge_group" && pr?.merged && pr.base.ref === "main" &&
      pr.head.repo?.full_name === REPOSITORY && pr.merge_commit_sha === run.head_sha) sha = pr.merge_commit_sha;
  return sha && /^[a-f0-9]{40}$/.test(sha) ? sha : undefined;
}

/** Contract 4.4: the live site names the merge it was built from. */
export const LIVE_VERSION = "https://crisp-globe-bf6v.here.now/version.txt";

/**
 * Where to look for website changes up to `sha`: from the commit the live site carries, so a website
 * merge whose own main run was cancelled by a later merge is still seen; else from `sha`'s first parent.
 */
export function publicationBase(sha: string, live: string | undefined, isAncestor: (commit: string) => boolean): string {
  const version = live?.trim();
  return version && /^[a-f0-9]{40}$/.test(version) && isAncestor(version) ? version : `${sha}^1`;
}

const buildFiles = new Set([
  "README.md", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
  ".npmrc", ".github/workflows/website.yml",
]);

interface PackageManifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Contract 4.3: both CI selection and stale-publication checks use the workspace dependency graph. */
export function websiteChanged(paths: readonly string[], root = fileURLToPath(new URL("../../../", import.meta.url))): boolean {
  if (paths.some(file => buildFiles.has(file))) return true;
  const packages = new Map<string, { directory: string; manifest: PackageManifest }>();
  // These are the workspace roots in pnpm-workspace.yaml; package membership comes from manifests.
  for (const file of globSync(["packages/*/package.json", "apps/*/package.json"], { cwd: root })) {
    const manifest: PackageManifest = JSON.parse(readFileSync(join(root, file), "utf8"));
    packages.set(manifest.name, { directory: file.replaceAll("\\", "/").replace(/package\.json$/, ""), manifest });
  }
  const pending = ["@storytree/website"];
  const directories = new Set<string>();
  if (!packages.has("@storytree/website")) throw new Error("Missing website workspace package.");
  while (pending.length) {
    const pkg = packages.get(pending.pop()!);
    if (!pkg || directories.has(pkg.directory)) continue;
    directories.add(pkg.directory);
    const { dependencies, devDependencies, optionalDependencies, peerDependencies } = pkg.manifest;
    pending.push(...Object.keys({ ...dependencies, ...devDependencies, ...optionalDependencies, ...peerDependencies }));
  }
  return [...directories].some(directory => paths.some(file => file.startsWith(directory)));
}

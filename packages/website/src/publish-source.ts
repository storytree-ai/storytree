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

/** Contract 4.3: queue merges produce a main push; CI's direct merges produce a PR run. */
export function publicationSource(run: CheckedRun, pr?: MergedPullRequest): string | undefined {
  if (run.conclusion !== "success" || run.head_repository?.full_name !== REPOSITORY) return undefined;
  let sha: string | null | undefined;
  if (run.event === "push" && run.head_branch === "main") sha = run.head_sha;
  if (run.event === "pull_request" && pr?.merged && pr.base.ref === "main" &&
      pr.head.repo?.full_name === REPOSITORY && pr.head.sha === run.head_sha) sha = pr.merge_commit_sha;
  return sha && /^[a-f0-9]{40}$/.test(sha) ? sha : undefined;
}

const buildFiles = new Set([
  "README.md", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
  ".npmrc", ".github/workflows/website.yml",
]);

export function websiteChanged(paths: readonly string[]): boolean {
  return paths.some(file => buildFiles.has(file) || file.startsWith("packages/website/") || file.startsWith("packages/forest-world/"));
}

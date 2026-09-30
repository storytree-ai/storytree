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

export function publicationSource(_run: CheckedRun, _pr?: MergedPullRequest): string | undefined {
  return undefined;
}

export function websiteChanged(_paths: readonly string[]): boolean {
  return false;
}

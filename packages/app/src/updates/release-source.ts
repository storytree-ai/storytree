/** Contract 4.6: a release starts at successful CI for work that actually reached main. */
interface Run {
  conclusion: string | null;
  event: string;
  head_sha: string;
  head_branch: string;
  head_repository: { full_name: string };
}
interface PullRequest {
  merged: boolean;
  merge_commit_sha: string | null;
  head: { sha: string; repo: { full_name: string } };
  base: { ref: string };
}
const REPOSITORY = "storytree-ai/storytree";

export function releaseSource(run: Run, pr?: PullRequest): string | undefined {
  if (run.conclusion !== "success" || run.head_repository.full_name !== REPOSITORY) return undefined;
  if (run.event === "push") return run.head_branch === "main" ? run.head_sha : undefined;
  if (run.event !== "pull_request" || !pr?.merged || pr.base.ref !== "main" ||
      pr.head.repo.full_name !== REPOSITORY || pr.head.sha !== run.head_sha) return undefined;
  return pr.merge_commit_sha ?? undefined;
}

/** The first-parent count increases only along main; reruns of a commit keep their version. */
export function releaseVersion(base: string, mainCount: number): string {
  if (!/^\d+\.\d+\.\d+$/.test(base) || !Number.isSafeInteger(mainCount) || mainCount < 1 || mainCount > 65535) {
    throw new Error("A release needs a stable base version and a main build number between 1 and 65535");
  }
  const [major, minor] = base.split(".");
  return `${major}.${minor}.${mainCount}`;
}

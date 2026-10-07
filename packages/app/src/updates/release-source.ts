/** Capability 4 · Updates. Contract 4.6: a release starts at successful CI for work that actually reached main. */
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

/** Runs git and answers its trimmed output. */
export type Git = (...args: string[]) => string;

/** The 0.3.<n> of `commit`, whether the desktop app or the command line reports it (ADR-0753 D2): the desktop app's base version as committed there, and main's first-parent count at it. */
export function versionAt(git: Git, commit: string): string {
  const base = (JSON.parse(git("show", `${commit}:apps/desktop/package.json`)) as { version: string }).version;
  return releaseVersion(base, Number(git("rev-list", "--first-parent", "--count", commit)));
}

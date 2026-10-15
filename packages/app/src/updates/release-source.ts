/** Capability 4 · Updates. Contract 4.6: a release starts at main's own successful CI run of the commit it ships.
 * Through the merge queue (ADR-0796) every merge to main is a push that CI tests in full on all three systems, so that
 * run is the verification and a release re-runs no tests; a pull request's run, or the queue's own, selects nothing. */
interface Run {
  conclusion: string | null;
  event: string;
  head_sha: string;
  head_branch: string;
  head_repository: { full_name: string };
}
const REPOSITORY = "storytree-ai/storytree";

export function releaseSource(run: Run): string | undefined {
  if (run.conclusion !== "success" || run.head_repository.full_name !== REPOSITORY) return undefined;
  return run.event === "push" && run.head_branch === "main" ? run.head_sha : undefined;
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

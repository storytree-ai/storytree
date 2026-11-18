// Capability 4 · Updates
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

export function releaseVersion(base: string, mainCount: number, countOffset = 0): string {
  if (!/^\d+\.\d+\.\d+$/.test(base) || !Number.isSafeInteger(mainCount) || !Number.isSafeInteger(countOffset) || mainCount < 1 || countOffset < 0 || mainCount + countOffset > 65535) {
    throw new Error("A release needs a stable base version and a main build number between 1 and 65535");
  }
  const [major, minor] = base.split(".");
  return `${major}.${minor}.${mainCount + countOffset}`;
}

export type Git = (...args: string[]) => string;

export function versionAt(git: Git, commit: string): string {
  const desktop = JSON.parse(git("show", `${commit}:apps/desktop/package.json`)) as { version: string; releaseCountOffset?: number };
  return releaseVersion(desktop.version, Number(git("rev-list", "--first-parent", "--count", commit)), desktop.releaseCountOffset ?? 0);
}

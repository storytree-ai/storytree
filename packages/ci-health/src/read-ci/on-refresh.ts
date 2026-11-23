// Capability 3 · Reading the project's CI.
import type { Library } from "@storytree/library";
import { ghApi, gitIn, readProjectCi, repositoryOf, type Git, type GitHub } from "./read-ci.js";

export const LOOK_EVERY_MS = 5 * 60 * 1000;

export type CiLook = (project: string, folder: string) => Promise<void>;

export function readCiOnRefresh({ open, github = ghApi(), git = gitIn, now = () => new Date() }: { open: (project: string) => Promise<Library>; github?: GitHub; git?: (folder: string) => Git; now?: () => Date }): CiLook {
  const lookedAt = new Map<string, number>();
  const lastRun = new Map<string, number>();
  const looking = new Map<string, Promise<void>>();

  const look = async (project: string, folder: string): Promise<void> => {
    const repository = repositoryOf(await git(folder)(["remote", "get-url", "origin"]).catch(() => ""));
    if (repository === undefined) return;
    const branch: string = (await github.json(`repos/${repository}`)).default_branch;
    const query = new URLSearchParams({ branch, event: "push", status: "completed", per_page: "1" });
    let runs: { id: number }[];
    try {
      runs = (await github.json(`repos/${repository}/actions/workflows/storytree.yml/runs?${query}`)).workflow_runs ?? [];
    } catch (error) {
      const said = `${error instanceof Error ? error.message : String(error)}\n${String((error as { stderr?: string })?.stderr ?? "")}`;
      if (/\bHTTP 404\b/.test(said)) return;
      throw error;
    }
    const newest = runs[0];
    if (newest === undefined || lastRun.get(project) === newest.id) return;
    const library = await open(project);
    await readProjectCi({ library, git: git(folder), github });
    lastRun.set(project, newest.id);
  };

  return async (project, folder) => {
    const under = looking.get(project);
    if (under !== undefined) return under;
    const at = now().getTime();
    const last = lookedAt.get(project);
    if (last !== undefined && at - last < LOOK_EVERY_MS) return;
    lookedAt.set(project, at);
    const started = look(project, folder).finally(() => looking.delete(project));
    looking.set(project, started);
    return started;
  };
}

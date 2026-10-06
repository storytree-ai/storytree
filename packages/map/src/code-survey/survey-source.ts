/** Capability 8 · Files from disk or an immutable merged Git tree; never check out over local work. */
import { type ChildProcess, execFile } from "node:child_process";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

type Entry = { name: string; directory: boolean; file: boolean };
export interface SurveySource {
  readonly root: string;
  entries(directory: string): Promise<readonly Entry[]>;
  file(full: string): Promise<{ version: string; read(): Promise<string> } | undefined>;
}

const execute = promisify(execFile);
const MAX_BYTES = 64 * 1024 * 1024;

async function git(folder: string, args: string[], input?: string): Promise<Buffer> {
  const run = execute("git", args, {
    cwd: folder, encoding: "buffer", maxBuffer: MAX_BYTES, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
  });
  // No interactive credentials, and no process kept between readings.
  let ended: Promise<void> | undefined;
  const deadline = setTimeout(() => { ended = endTree(run.child); }, 5_000);
  run.child.stdin?.on("error", () => {}); // An early Git exit is reported by the promise.
  run.child.stdin?.end(input);
  try {
    return (await run).stdout;
  } finally {
    clearTimeout(deadline);
    await ended;
  }
}

/**
 * End a Git that ran past its deadline, with every process it started. On Windows `git` is often
 * Git for Windows' launcher, and killing it leaves its real git.exe running with the repository open.
 */
function endTree(child: ChildProcess): Promise<void> {
  if (process.platform !== "win32" || child.pid === undefined) {
    child.kill();
    return Promise.resolve();
  }
  return new Promise(resolve => execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve()));
}
const gitText = async (folder: string, args: string[]) => (await git(folder, args)).toString("utf8").trim();

function disk(root: string, read: (file: string) => Promise<string>): SurveySource {
  return {
    root,
    async entries(directory) {
      return (await readdir(directory, { withFileTypes: true }).catch(() => [])).map(entry => ({
        name: entry.name, directory: entry.isDirectory(), file: entry.isFile(),
      }));
    },
    async file(full) {
      const found = await stat(full).catch(() => undefined);
      return found?.isFile() ? { version: `${found.size}:${found.mtimeMs}`, read: () => read(full) } : undefined;
    },
  };
}

/** All worktrees and readers share one fetch and one immutable directory reading per repository. */
type Repository = { reading?: Promise<SurveySource | undefined>; commit?: string; source?: SurveySource };
const repositories = new Map<string, Repository>();

async function merged(common: string, root: string): Promise<SurveySource | undefined> {
  let kept = repositories.get(common);
  if (kept === undefined) {
    kept = {};
    repositories.set(common, kept);
  }
  const repository = kept;
  // The forest paces requests. Share overlapping asks here, but never answer a later landing's
  // request from a cooldown cache: it might be the only ask that landing produces.
  repository.reading ??= refresh(common, root, repository).finally(() => { delete repository.reading; });
  return repository.reading;
}

async function refresh(common: string, root: string, kept: Repository): Promise<SurveySource | undefined> {
  const args = ["--git-dir", common];
  const origin = await gitText(common, [...args, "config", "--get", "remote.origin.url"]).catch((error: { code?: number }) => {
    if (error.code === 1) return "";
    throw error;
  });
  if (!origin) return undefined; // A local-only project keeps its primary-folder reading.
  let fetchError: unknown;
  try {
    await git(common, [...args, "fetch", "--quiet", "--no-tags", "--no-auto-maintenance", "--no-recurse-submodules", "--no-write-fetch-head",
      "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  } catch (error) {
    fetchError = error;
  }
  const commit = await gitText(common, [...args, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}"]).catch(() => {
    throw new Error("Cannot survey merged code: origin/main is unavailable and no fetched main is kept.", { cause: fetchError });
  });
  if (kept.commit === commit) return kept.source!;
  const source = await snapshot(common, root, commit);
  kept.commit = commit;
  kept.source = source;
  return source;
}

/** Tree entries and blob identities are immutable. Text is batched only when the survey asks for it. */
async function snapshot(common: string, root: string, commit: string): Promise<SurveySource> {
  const args = ["--git-dir", common];
  const files = new Map<string, string>();
  const directories = new Map<string, Map<string, Entry>>();
  for (const entry of (await git(common, [...args, "ls-tree", "-rz", "--full-tree", commit])).toString("utf8").split("\0")) {
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, sha] = entry.slice(0, tab).split(" ");
    if ((mode !== "100644" && mode !== "100755") || type !== "blob" || !sha) continue;
    const name = entry.slice(tab + 1);
    const full = path.resolve(root, name);
    if (!full.startsWith(root + path.sep)) throw new Error("Git survey path escapes its repository.");
    files.set(full, sha);
    let child = full;
    while (child !== root) {
      const parent = path.dirname(child);
      let entries = directories.get(parent);
      if (!entries) directories.set(parent, entries = new Map());
      const name = path.basename(child);
      if (entries.has(name)) break;
      entries.set(name, { name, directory: child !== full, file: child === full });
      child = parent;
    }
  }

  const texts = new Map<string, Promise<string>>();
  let pending = new Map<string, { resolve(text: string): void; reject(error: unknown): void }>();
  let scheduled = false;
  // At most one bounded batch runs at once, even when several readers need different stories.
  let running = Promise.resolve();
  const read = (sha: string): Promise<string> => {
    let text = texts.get(sha);
    if (text !== undefined) return text;
    text = new Promise<string>((resolve, reject) => pending.set(sha, { resolve, reject }));
    texts.set(sha, text);
    if (!scheduled) {
      scheduled = true;
      setImmediate(() => {
        const batch = pending;
        pending = new Map();
        scheduled = false;
        running = running.then(async () => {
          try {
            const output = await git(common, [...args, "cat-file", "--batch"], [...batch.keys()].join("\n") + "\n");
            let at = 0;
            const loaded: [string, string][] = [];
            for (const sha of batch.keys()) {
              const end = output.indexOf(10, at);
              const header = /^(\S+) blob (\d+)$/.exec(output.subarray(at, end).toString("ascii"));
              if (end < at || !header || header[1] !== sha) throw new Error("Git returned an invalid survey blob header.");
              const size = Number(header[2]);
              const next = end + 1 + size;
              if (!Number.isSafeInteger(size) || next >= output.length || output[next] !== 10) throw new Error("Git returned an incomplete survey blob.");
              loaded.push([sha, output.subarray(end + 1, next).toString("utf8")]);
              at = next + 1;
            }
            for (const [sha, text] of loaded) batch.get(sha)!.resolve(text);
          } catch (error) {
            for (const [sha, waiter] of batch) { texts.delete(sha); waiter.reject(error); }
          }
        });
      });
    }
    return text;
  };
  return {
    root,
    async entries(directory) { return [...directories.get(directory)?.values() ?? []].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0); },
    async file(full) {
      const sha = files.get(full);
      return sha === undefined ? undefined : { version: sha, read: () => read(sha) };
    },
  };
}

export function surveySourceReader(scope: "main" | "current", readText: (file: string) => Promise<string>) {
  const folders = new Map<string, Promise<{ root: string; common?: string }>>();
  return async (folder: string): Promise<SurveySource> => {
    folder = path.resolve(folder);
    if (!folders.has(folder)) folders.set(folder, (async () => {
      try {
        const found = await gitText(folder, ["rev-parse", "--path-format=absolute", scope === "main" ? "--git-common-dir" : "--show-toplevel"]);
        if (scope === "current") return { root: found };
        const common = await realpath(found);
        return { root: path.basename(common) === ".git" ? path.dirname(common) : folder, common };
      } catch {
        return { root: folder };
      }
    })());
    const { root, common } = await folders.get(folder)!;
    return (common === undefined ? undefined : await merged(common, root)) ?? disk(root, readText);
  };
}

/** Capability 8 · Files from disk or an immutable merged Git tree; never check out over local work. */
import { type ChildProcess, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { SurveyPackage } from "./code-survey.js";

/** The folders a survey never reads into. */
export const SKIPPED = new Set(["node_modules", "dist", "out", "evidence"]);

/** The dependency fields of a package.json, in the order their names are listed. */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

/** A package.json's name and the packages it depends on through any field; undefined when it cannot be read. */
export function manifestFrom(text: string): { name: string; deps: string[]; exports: SurveyPackage["exports"]; imports: NonNullable<SurveyPackage["imports"]> } | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.name !== "string") return undefined;
    const deps = DEPENDENCY_FIELDS.flatMap((field) => {
      const named = parsed[field];
      return typeof named === "object" && named !== null ? Object.keys(named) : [];
    });
    const exports = typeof parsed.exports === "string" ? { ".": parsed.exports } : parsed.exports;
    const literal = typeof exports === "object" && exports !== null ? Object.entries(exports).filter(([key, target]) =>
      (key === "." || key.startsWith("./")) && !key.includes("*") && typeof target === "string" && target.startsWith("./")
      && !target.includes("*") && !target.split("/").slice(1).some(part => part === ".." || part === "node_modules"),
    ) as [string, string][] : [];
    // Its own '#' imports, read the same way: a literal key mapped to a literal file inside the package.
    const own = typeof parsed.imports === "object" && parsed.imports !== null ? Object.entries(parsed.imports).filter(([key, target]) =>
      key.startsWith("#") && !key.includes("*") && typeof target === "string" && target.startsWith("./")
      && !target.includes("*") && !target.split("/").slice(1).some(part => part === ".." || part === "node_modules"),
    ) as [string, string][] : [];
    return { name: parsed.name, deps: [...new Set(deps)], exports: Object.fromEntries(literal), imports: Object.fromEntries(own) };
  } catch {
    return undefined;
  }
}

type Entry = { name: string; directory: boolean; file: boolean };
export interface SurveySource {
  readonly root: string;
  /** The commit an immutable snapshot reads; none for a folder read from disk. */
  readonly commit?: string;
  entries(directory: string): Promise<readonly Entry[]>;
  file(full: string): Promise<{ version: string; read(): Promise<string> } | undefined>;
}

const execute = promisify(execFile);
const MAX_BYTES = 64 * 1024 * 1024;
/** No program a repository's own settings name runs: no file monitor, no hook (from a folder that never exists), no command transport. */
const NEUTRAL = ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${path.join(tmpdir(), `storytree-no-hooks-${randomUUID()}`)}`, "-c", "protocol.ext.allow=never"];
/** The fetch of main speaks only transports that run nothing named in the repository's settings. */
const FETCH_PROTOCOLS = ["-c", "protocol.allow=never", ...["https", "ssh", "file", "git"].flatMap(name => ["-c", `protocol.${name}.allow=always`])];
/** Repository settings that name a program a fetch would run; any one of them skips the fetch. */
const FETCH_PROGRAMS = "^(remote\\.origin\\.uploadpack|core\\.sshcommand|credential\\..*helper)$";

async function git(folder: string, args: string[], input?: string): Promise<Buffer> {
  const run = execute("git", [...NEUTRAL, ...args], {
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
export const gitText = async (folder: string, args: string[]) => (await git(folder, args)).toString("utf8").trim();

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
type Repository = {
  reading?: Promise<SurveySource | undefined>; commit?: string; source?: SurveySource;
  /** A start's fetch that its first answer did not wait on, and how it ended: the next ask waits on it instead of fetching again. */
  fetching?: Promise<unknown>;
};
const repositories = new Map<string, Repository>();

async function merged(common: string, root: string, startFromFetched: boolean): Promise<SurveySource | undefined> {
  let kept = repositories.get(common);
  if (kept === undefined) {
    kept = {};
    repositories.set(common, kept);
  }
  const repository = kept;
  // The forest paces requests. Share overlapping asks here, but never answer a later landing's
  // request from a cooldown cache: it might be the only ask that landing produces.
  repository.reading ??= refresh(common, root, repository, startFromFetched).finally(() => { delete repository.reading; });
  return repository.reading;
}

async function refresh(common: string, root: string, kept: Repository, startFromFetched: boolean): Promise<SurveySource | undefined> {
  const args = ["--git-dir", common];
  const origin = await gitText(common, [...args, "config", "--get", "remote.origin.url"]).catch((error: { code?: number }) => {
    if (error.code === 1) return "";
    throw error;
  });
  if (!origin) return undefined; // A local-only project keeps its primary-folder reading.
  const fetchedMain = () => gitText(common, [...args, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}"]);
  // Read before the fetch is started, so a start's fetch is already under way when its first answer lands (8.27).
  const blocked = async () => {
    const programs = await gitText(common, [...args, "config", "--local", "--includes", "--name-only", "--get-regexp", FETCH_PROGRAMS]).catch((error: { code?: number }) => {
      if (error.code === 1) return "";
      throw error;
    }).catch((error: unknown) => error ?? new Error("Git config could not be read."));
    if (typeof programs !== "string") return programs;
    if (programs) return new Error(`Skipped fetching origin/main: this repository's settings name a program the fetch would run (${programs.split("\n").join(", ")}).`);
    return undefined;
  };
  const fetch = (skip: unknown): Promise<unknown> => skip !== undefined ? Promise.resolve(skip)
    : git(common, [...FETCH_PROTOCOLS, ...args, "fetch", "--quiet", "--no-tags", "--no-auto-maintenance", "--no-recurse-submodules", "--no-write-fetch-head",
      "origin", "+refs/heads/main:refs/remotes/origin/main"]).then(() => undefined, (error: unknown) => error ?? new Error("Git fetch failed."));
  let fetchError: unknown;
  // A start answers its first ask from the main already fetched and fetches meanwhile (8.27).
  const already = startFromFetched && kept.commit === undefined && kept.fetching === undefined ? await fetchedMain().catch(() => undefined) : undefined;
  if (already !== undefined) {
    kept.fetching = fetch(await blocked());
  } else if (kept.fetching !== undefined) {
    fetchError = await kept.fetching;
    delete kept.fetching;
  } else {
    fetchError = await fetch(await blocked());
  }
  const commit = already ?? await fetchedMain().catch(() => {
    throw new Error("Cannot survey merged code: origin/main is unavailable and no fetched main is kept.", { cause: fetchError });
  });
  if (kept.commit === commit) return kept.source!;
  const source = await snapshot(common, root, commit);
  kept.commit = commit;
  kept.source = source;
  return source;
}

/**
 * Tree entries and blob identities are immutable. Text is batched only when the survey asks for it, and kept
 * for a later ask unless `forget` says the asker keeps what it needs of it.
 */
async function snapshot(common: string, root: string, commit: string, forget = false): Promise<SurveySource> {
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
            for (const [sha, text] of loaded) {
              batch.get(sha)!.resolve(text);
              if (forget) texts.delete(sha);
            }
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
    commit,
    async entries(directory) { return [...directories.get(directory)?.values() ?? []].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0); },
    async file(full) {
      const sha = files.get(full);
      return sha === undefined ? undefined : { version: sha, read: () => read(sha) };
    },
  };
}

/** An imported checkout's last snapshot, by its Git directory: kept while its commit stands. */
const imported = new Map<string, { commit: string; source: Promise<SurveySource> }>();

/**
 * The files of an imported folder (ADR-0993 D2): those Git tracks at its checkout's commit, read from that
 * commit's immutable tree with one Git call per ask while the commit stands, and `commit` naming it; a folder
 * that is no checkout with a commit is read from disk, with no commit. `folder` is the folder as the source spells it.
 * Work done there and not committed (a changed, new or deleted file Git does not ignore) stands over the commit's
 * tree, read from disk, and `local` names it (each such file with its size and modified time) so a survey of it
 * is kept only while it is unchanged.
 */
export async function importedSource(folder: string, readText: (file: string) => Promise<string>): Promise<{ source: SurveySource; folder: string; commit?: string; local?: string }> {
  const found = await gitText(folder, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir", "HEAD", "--show-prefix"]).catch(() => undefined);
  const [top, common, commit, prefix = ""] = found?.split("\n") ?? [];
  if (top === undefined || common === undefined || commit === undefined) return { source: disk(folder, readText), folder };
  const root = path.resolve(top);
  let kept = imported.get(common);
  if (kept?.commit !== commit) {
    const source = snapshot(common, root, commit, true);
    source.catch(() => { if (imported.get(common)?.source === source) imported.delete(common); });
    kept = { commit, source };
    imported.set(common, kept);
  }
  const at = { folder: path.resolve(root, prefix), commit };
  const local = await localWork(root);
  if (local.size === 0) return { source: await kept.source, ...at };
  return { source: overlaid(await kept.source, local, readText), ...at, local: JSON.stringify([...local].sort(([a], [b]) => (a < b ? -1 : 1))) };
}

/**
 * Each file the checkout at `root` changed, added or deleted since its commit, Git's ignored files left out, by full
 * path: its version on disk (size and modified time), or undefined when it is not there. Nothing is written into the
 * checkout: Git is told not to take its optional index lock.
 */
async function localWork(root: string): Promise<Map<string, string | undefined>> {
  const listed = (await git(root, ["--no-optional-locks", "status", "--porcelain", "-z", "--untracked-files=all", "--no-renames"])).toString("utf8");
  const local = new Map<string, string | undefined>();
  for (const entry of listed.split("\0")) {
    if (entry.length < 4) continue;
    const full = path.resolve(root, entry.slice(3));
    if (!full.startsWith(root + path.sep)) throw new Error("Git survey path escapes its repository.");
    const found = await lstat(full).catch(() => undefined);
    local.set(full, found?.isFile() ? `${found.size}:${found.mtimeMs}` : undefined);
  }
  return local;
}

/** `base` with `local`'s files standing over it: each read from disk, or gone when it is not there. */
function overlaid(base: SurveySource, local: ReadonlyMap<string, string | undefined>, read: (file: string) => Promise<string>): SurveySource {
  const added = new Map<string, Map<string, Entry>>();
  const gone = new Map<string, Set<string>>();
  for (const [full, version] of local) {
    if (version === undefined) {
      gone.set(path.dirname(full), (gone.get(path.dirname(full)) ?? new Set()).add(path.basename(full)));
      continue;
    }
    let child = full;
    while (child !== base.root) {
      const parent = path.dirname(child);
      let entries = added.get(parent);
      if (!entries) added.set(parent, entries = new Map());
      const name = path.basename(child);
      if (entries.has(name)) break;
      entries.set(name, { name, directory: child !== full, file: child === full });
      child = parent;
    }
  }
  return {
    root: base.root,
    async entries(directory) {
      const entries = new Map((await base.entries(directory)).map((entry) => [entry.name, entry]));
      for (const name of gone.get(directory) ?? []) if (entries.get(name)?.file) entries.delete(name);
      for (const [name, entry] of added.get(directory) ?? []) if (!entries.has(name)) entries.set(name, entry);
      return [...entries.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    },
    async file(full) {
      if (!local.has(full)) return base.file(full);
      const version = local.get(full);
      return version === undefined ? undefined : { version, read: () => read(full) };
    },
  };
}

/** With `startFromFetched`, a repository's first ask is answered from the main already fetched while it fetches (8.27). */
export function surveySourceReader(scope: "main" | "current", readText: (file: string) => Promise<string>, startFromFetched = false) {
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
    return (common === undefined ? undefined : await merged(common, root, startFromFetched)) ?? disk(root, readText);
  };
}

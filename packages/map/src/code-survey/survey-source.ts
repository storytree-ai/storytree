// Capability 8 · Code survey
import { type ChildProcess, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { SurveyPackage } from "./code-survey.js";

export const SKIPPED = new Set(["node_modules", "dist", "out", "evidence", "__pycache__", ".venv", "venv"]);

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

export function manifestFrom(text: string): { name: string; deps: string[]; exports: SurveyPackage["exports"]; imports: NonNullable<SurveyPackage["imports"]>; parts: NonNullable<SurveyPackage["parts"]> } | undefined {
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
    const own = typeof parsed.imports === "object" && parsed.imports !== null ? Object.entries(parsed.imports).filter(([key, target]) =>
      key.startsWith("#") && !key.includes("*") && typeof target === "string" && target.startsWith("./")
      && !target.includes("*") && !target.split("/").slice(1).some(part => part === ".." || part === "node_modules"),
    ) as [string, string][] : [];
    const manifest = typeof parsed.storytree === "object" && parsed.storytree !== null ? parsed.storytree as Record<string, unknown> : {};
    const parts = Object.fromEntries(Object.entries(manifest).flatMap(([kind, entries]) => !Array.isArray(entries) ? [] : [[kind, entries.flatMap((entry: { from?: unknown; export?: unknown } | null) =>
      typeof entry?.from === "string" && typeof entry.export === "string" ? [{ from: entry.from, export: entry.export }] : [])] as const]));
    return { name: parsed.name, deps: [...new Set(deps)], exports: Object.fromEntries(literal), imports: Object.fromEntries(own), parts };
  } catch {
    return undefined;
  }
}

type Entry = { name: string; directory: boolean; file: boolean };
export interface SurveySource {
  readonly root: string;
  readonly commit?: string;
  entries(directory: string): Promise<readonly Entry[]>;
  file(full: string): Promise<{ version: string; read(): Promise<string> } | undefined>;
}

const execute = promisify(execFile);
const MAX_BYTES = 64 * 1024 * 1024;
const NEUTRAL = ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${path.join(tmpdir(), `storytree-no-hooks-${randomUUID()}`)}`, "-c", "protocol.ext.allow=never"];
const FETCH_PROTOCOLS = ["-c", "protocol.allow=never", ...["https", "ssh", "file", "git"].flatMap(name => ["-c", `protocol.${name}.allow=always`])];
const FETCH_PROGRAMS = "^(remote\\.origin\\.uploadpack|core\\.sshcommand|credential\\..*helper)$";

async function git(folder: string, args: string[], input?: string): Promise<Buffer> {
  const run = execute("git", [...NEUTRAL, ...args], {
    cwd: folder, encoding: "buffer", maxBuffer: MAX_BYTES, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" },
  });
  let ended: Promise<void> | undefined;
  const deadline = setTimeout(() => { ended = endTree(run.child); }, 5_000);
  run.child.stdin?.on("error", () => {});
  run.child.stdin?.end(input);
  try {
    return (await run).stdout;
  } finally {
    clearTimeout(deadline);
    await ended;
  }
}

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

type Repository = {
  reading?: Promise<SurveySource | undefined>; commit?: string; source?: SurveySource;
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
  repository.reading ??= refresh(common, root, repository, startFromFetched).finally(() => { delete repository.reading; });
  return repository.reading;
}

const NO_MERGED_MAIN = "Cannot survey merged code: origin/main is unavailable and no fetched main is kept.";

export function noMergedMain(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(NO_MERGED_MAIN);
}

function whyNotFetched(error: unknown): string {
  const said = (error as { stderr?: Buffer | string } | undefined)?.stderr?.toString().trim().split("\n")[0];
  if (said) return said;
  return error instanceof Error ? error.message : "The fetch of main did not run.";
}

async function refresh(common: string, root: string, kept: Repository, startFromFetched: boolean): Promise<SurveySource | undefined> {
  const args = ["--git-dir", common];
  const origin = await gitText(common, [...args, "config", "--get", "remote.origin.url"]).catch((error: { code?: number }) => {
    if (error.code === 1) return "";
    throw error;
  });
  if (!origin) return undefined;
  const fetchedMain = () => gitText(common, [...args, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}"]);
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
    throw new Error(`${NO_MERGED_MAIN} ${whyNotFetched(fetchError)}`, { cause: fetchError });
  });
  if (kept.commit === commit) return kept.source!;
  const source = await snapshot(common, root, commit);
  kept.commit = commit;
  kept.source = source;
  return source;
}

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

const imported = new Map<string, { commit: string; source: Promise<SurveySource> }>();

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

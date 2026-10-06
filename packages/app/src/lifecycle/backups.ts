/**
 * Capability 1 · Lifecycle, contract 1.8 (the app story; ADR-0641 D2 step 4, choice B1): once a
 * project's library is the only copy of its plan, the app keeps snapshots of it. keepBackups gives
 * each project one a day: at start it takes one of each project whose newest successful snapshot is
 * missing or a day old, reusing one under a day old (increment_cdce468a4e1a: the development app
 * restarts on every merged build), and while it runs takes the next at each project's day mark.
 * backUp writes one snapshot of each project to <dir>/<project>/<time>.json (the library's
 * `snapshot`, records and history), under that name only once whole, and keeps that project's newest
 * BACKUPS_KEPT. A file there that is not a snapshot is never touched. A snapshot restores only into
 * an empty project (the library's `restore`), so it can never overwrite live edits.
 */
import { closeSync, fstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Storytree } from "@storytree/library";

/** How often the app takes its snapshots while it runs: once a day. */
export const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
/** How many snapshots of each project are kept: the newest. */
export const BACKUPS_KEPT = 14;

/** A snapshot's file name: its time, sortable as text (2026-09-27T01-02-03-456Z.json). */
const SNAPSHOT_FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;
/** A snapshot still being written, renamed to its snapshot name once whole. */
const PARTIAL_FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json\.partial$/;
/** The shortest wait before the next run, so a project that cannot be snapshotted never spins. */
const SOONEST_MS = 60 * 1000;

export interface BackUpOptions {
  readonly storytree: Pick<Storytree, "snapshot">;
  /** The projects to take a snapshot of. */
  readonly projects: readonly string[];
  /** Where the snapshots go: ~/.storytree/0.3/backups for the app. */
  readonly dir: string;
  /** The snapshots' time, which names their files. */
  readonly now?: Date;
  /** How many of each project's snapshots to keep. */
  readonly keep?: number;
}

/** Write a snapshot of each project and prune each project's folder to its newest `keep`. The files written, in project order. */
export async function backUp({ storytree, projects, dir, now = new Date(), keep = BACKUPS_KEPT }: BackUpOptions): Promise<string[]> {
  const name = `${now.toISOString().replace(/[:.]/g, "-")}.json`;
  const written: string[] = [];
  for (const project of projects) {
    const snapshot = await storytree.snapshot(project);
    const folder = path.join(dir, project);
    mkdirSync(folder, { recursive: true });
    for (const stale of readdirSync(folder).filter((entry) => PARTIAL_FILE.test(entry))) rmSync(path.join(folder, stale));
    const file = path.join(folder, name);
    writeFileSync(`${file}.partial`, `${JSON.stringify(snapshot)}\n`);
    renameSync(`${file}.partial`, file);
    written.push(file);
    const snapshots = readdirSync(folder).filter((entry) => SNAPSHOT_FILE.test(entry)).sort();
    for (const old of snapshots.slice(0, Math.max(0, snapshots.length - keep))) rmSync(path.join(folder, old));
  }
  return written;
}

/** When a project's newest successful snapshot was taken, read from its file name; undefined when it has none. */
export function newestSnapshot(dir: string, project: string): Date | undefined {
  const folder = path.join(dir, project);
  let entries: string[];
  try { entries = readdirSync(folder); } catch { return undefined; }
  for (const entry of entries.filter((name) => SNAPSHOT_FILE.test(name)).sort().reverse()) {
    if (!whole(path.join(folder, entry))) continue;
    const [day, time] = entry.slice(0, -".json".length).split("T") as [string, string];
    const [h, m, s, ms] = time.slice(0, -1).split("-");
    return new Date(`${day}T${h}:${m}:${s}.${ms}Z`);
  }
  return undefined;
}

/** A snapshot file written to its end: backUp ends each with "}\n", which an interrupted write lacks. */
function whole(file: string): boolean {
  const fd = openSync(file, "r");
  try {
    const { size } = fstatSync(fd);
    if (size < 2) return false;
    const end = Buffer.alloc(2);
    readSync(fd, end, 0, 2, size - 2);
    return end.toString() === "}\n";
  } finally {
    closeSync(fd);
  }
}

/** Keep each project's daily snapshot, reusing one under a day old at start, and hold update restarts until their library reads and files finish. */
export function keepBackups(options: {
  storytree: Pick<Storytree, "listProjects" | "snapshot">;
  dir: string;
  log: (message: string) => void;
}) {
  let taking = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  // One timer, re-armed after each run for the soonest project's day mark.
  const arm = (wait: number): void => {
    if (stopped) return;
    timer = setInterval(() => void take(), Math.max(SOONEST_MS, wait));
    timer.unref();
  };
  const take = async (): Promise<void> => {
    if (taking || stopped) return;
    taking = true;
    clearInterval(timer);
    let wait = BACKUP_EVERY_MS;
    try {
      const projects = await options.storytree.listProjects();
      const now = Date.now();
      const due = projects.filter((project) => (newestSnapshot(options.dir, project)?.getTime() ?? -Infinity) + BACKUP_EVERY_MS <= now);
      if (due.length > 0) {
        const written = await backUp({ ...options, projects: due });
        options.log(`backups: ${written.length} project snapshot${written.length === 1 ? "" : "s"} in ${options.dir}`);
      }
      const marks = projects.map((project) => (newestSnapshot(options.dir, project)?.getTime() ?? -Infinity) + BACKUP_EVERY_MS);
      if (marks.length > 0) wait = Math.min(...marks) - Date.now();
    } catch (error) {
      options.log(`backups: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      taking = false;
      arm(wait);
    }
  };
  void take();
  return {
    canRestart: () => !taking,
    stop: () => { stopped = true; clearInterval(timer); },
  };
}

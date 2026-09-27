/**
 * Capability 1 · Lifecycle, contract 1.8 (stories/app.md; ADR-0641 D2 step 4, choice B1): once a
 * project's library is the only copy of its plan, the app keeps snapshots of it. At start and once
 * a day while it runs, apps/desktop calls backUp, which writes one snapshot of each project to
 * <dir>/<project>/<time>.json (the library's `snapshot`, records and history) and keeps that
 * project's newest BACKUPS_KEPT. A file there that is not a snapshot is never touched. A snapshot
 * restores only into an empty project (the library's `restore`), so it can never overwrite live edits.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Storytree } from "@storytree/library";

/** How often the app takes its snapshots while it runs: once a day. */
export const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
/** How many snapshots of each project are kept: the newest. */
export const BACKUPS_KEPT = 14;

/** A snapshot's file name: its time, sortable as text (2026-09-27T01-02-03-456Z.json). */
const SNAPSHOT_FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;

export interface BackUpOptions {
  readonly storytree: Storytree;
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
    const file = path.join(folder, name);
    writeFileSync(file, `${JSON.stringify(snapshot)}\n`);
    written.push(file);
    const snapshots = readdirSync(folder).filter((entry) => SNAPSHOT_FILE.test(entry)).sort();
    for (const old of snapshots.slice(0, Math.max(0, snapshots.length - keep))) rmSync(path.join(folder, old));
  }
  return written;
}

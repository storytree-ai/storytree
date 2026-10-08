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
import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  repairBackupPermissions(dir);
  const name = `${now.toISOString().replace(/[:.]/g, "-")}.json`;
  const written: string[] = [];
  for (const project of projects) {
    const snapshot = await storytree.snapshot(project);
    const folder = path.join(dir, project);
    privateDirectories([dir, folder]);
    for (const stale of readdirSync(folder).filter((entry) => PARTIAL_FILE.test(entry))) rmSync(path.join(folder, stale));
    const file = path.join(folder, name);
    // Windows creates the empty partial with an explicit DACL atomically. Opening it only after
    // that succeeds never puts snapshot bytes in a file with permissive inherited permissions.
    if (process.platform === "win32") windowsPermissions([{ file: `${file}.partial`, kind: "create" }]);
    writeFileSync(`${file}.partial`, `${JSON.stringify(snapshot)}\n`, { mode: 0o600, flag: process.platform === "win32" ? "r+" : "wx" });
    renameSync(`${file}.partial`, file);
    written.push(file);
    const snapshots = readdirSync(folder).filter((entry) => SNAPSHOT_FILE.test(entry)).sort();
    for (const old of snapshots.slice(0, Math.max(0, snapshots.length - keep))) rmSync(path.join(folder, old));
  }
  return written;
}

/** Privacy belongs to the backup tree, independent of the application's home or umask. */
function privateDirectories(dirs: string[]): void {
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!lstatSync(dir).isDirectory()) throw new Error(`Backup folder is not a directory: ${dir}`);
    if (process.platform !== "win32") chmodSync(dir, 0o700);
  }
  if (process.platform === "win32") windowsPermissions(dirs.map(file => ({ file, kind: "directory" })));
}

/** Repair before reusing a fresh snapshot, including retained projects no longer in the library.
 * Only real project folders and our snapshot/partial files belong to this lifecycle; no symlinks
 * are followed and unrelated files keep their permissions and contents.
 */
function repairBackupPermissions(dir: string): void {
  const stat = lstatSync(dir, { throwIfNoEntry: false });
  if (stat === undefined) return;
  if (!stat.isDirectory()) throw new Error(`Backup folder is not a directory: ${dir}`);
  const entries: WindowsPermission[] = [];
  const repair = (entry: WindowsPermission): void => {
    if (process.platform === "win32") entries.push(entry);
    else chmodSync(entry.file, entry.kind === "directory" ? 0o700 : 0o600);
  };
  repair({ file: dir, kind: "directory" });
  for (const project of readdirSync(dir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const folder = path.join(dir, project.name);
    repair({ file: folder, kind: "directory" });
    for (const file of readdirSync(folder, { withFileTypes: true })) {
      if (file.isFile() && (SNAPSHOT_FILE.test(file.name) || PARTIAL_FILE.test(file.name))) {
        repair({ file: path.join(folder, file.name), kind: "file" });
      }
    }
  }
  if (process.platform === "win32") windowsPermissions(entries);
}

type WindowsPermission = { file: string; kind: "directory" | "file" | "create" };

/** Replace both inherited and explicit grants with the current user's SID alone. SetFileSecurity
 * deliberately avoids propagating directory changes into unrelated children; every snapshot gets a
 * protected DACL. Windows PowerShell's .NET Framework FileStream overload creates a partial exclusively with
 * that DACL, before it can contain bytes. Any refusal aborts the backup; chmod is no ACL fallback.
 */
function windowsPermissions(entries: WindowsPermission[]): void {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$entries = ConvertFrom-Json ([Console]::In.ReadToEnd())
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
# SetAccessControl/SetNamedSecurityInfo propagate removal of inherited rules into unrelated files.
# This supported legacy API changes only the named object (including its protected-DACL flag).
# https://learn.microsoft.com/windows/win32/api/securitybaseapi/nf-securitybaseapi-setfilesecurityw
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class BackupPermissions {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool SetFileSecurityW(string name, uint information, byte[] descriptor);
  public static void Set(string name, byte[] descriptor) {
    // OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION
    if (!SetFileSecurityW(name, 0x80000005, descriptor)) throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
foreach ($entry in $entries) {
  $acl = if ($entry.kind -eq 'directory') { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
  $acl.SetOwner($owner)
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner, 'FullControl', 'Allow'))
  if ($entry.kind -eq 'create') {
    $stream = [IO.FileStream]::new($entry.file, [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::Write, [IO.FileShare]::None, 4096, [IO.FileOptions]::None, $acl)
    $stream.Dispose()
  } else {
    [BackupPermissions]::Set($entry.file, $acl.GetSecurityDescriptorBinaryForm())
  }
}`;
  const env = { ...process.env };
  // A parent PowerShell 7's module path can break Windows PowerShell 5's built-in cmdlets.
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PSMODULEPATH") delete env[key];
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { input: JSON.stringify(entries), env, windowsHide: true, timeout: 30_000, stdio: ["pipe", "pipe", "pipe"] });
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
      repairBackupPermissions(options.dir);
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

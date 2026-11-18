// Capability 10 · Daily snapshots
import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, createReadStream, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmSync, writeSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

import type { ProjectSnapshot, Storytree } from "@storytree/library";

export const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
export const BACKUPS_KEPT = 14;

const SNAPSHOT_FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/;
const PARTIAL_FILE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json\.partial$/;
const SOONEST_MS = 60 * 1000;

export interface BackUpOptions {
  readonly storytree: Pick<Storytree, "snapshot">;
  readonly projects: readonly string[];
  readonly dir: string;
  readonly now?: Date;
  readonly keep?: number;
  readonly stringify?: (value: unknown) => string;
}

export async function backUp({ storytree, projects, dir, now = new Date(), keep = BACKUPS_KEPT, stringify = JSON.stringify }: BackUpOptions): Promise<string[]> {
  repairBackupPermissions(dir);
  const name = `${now.toISOString().replace(/[:.]/g, "-")}.json`;
  const written: string[] = [];
  for (const project of projects) {
    const snapshot = await storytree.snapshot(project);
    const folder = path.join(dir, project);
    privateDirectories([dir, folder]);
    for (const stale of readdirSync(folder).filter((entry) => PARTIAL_FILE.test(entry))) rmSync(path.join(folder, stale));
    const file = path.join(folder, name);
    if (process.platform === "win32") windowsPermissions([{ file: `${file}.partial`, kind: "create" }]);
    writeSnapshot(`${file}.partial`, snapshot, stringify);
    renameSync(`${file}.partial`, file);
    written.push(file);
    const snapshots = readdirSync(folder).filter((entry) => SNAPSHOT_FILE.test(entry)).sort();
    for (const old of snapshots.slice(0, Math.max(0, snapshots.length - keep))) rmSync(path.join(folder, old));
  }
  return written;
}

function privateDirectories(dirs: string[]): void {
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!lstatSync(dir).isDirectory()) throw new Error(`Backup folder is not a directory: ${dir}`);
    if (process.platform !== "win32") chmodSync(dir, 0o700);
  }
  if (process.platform === "win32") windowsPermissions(dirs.map(file => ({ file, kind: "directory" })));
}

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
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PSMODULEPATH") delete env[key];
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { input: JSON.stringify(entries), env, windowsHide: true, timeout: 120_000, stdio: ["pipe", "pipe", "pipe"] });
}

const WRITE_CHUNK = 1 << 20;

function writeSnapshot(partial: string, snapshot: ProjectSnapshot, stringify: (value: unknown) => string): void {
  const { records, history, media, ...head } = snapshot;
  const fd = openSync(partial, process.platform === "win32" ? "r+" : "wx", 0o600);
  try {
    let pending = "";
    const put = (text: string): void => {
      pending += text;
      if (pending.length >= WRITE_CHUNK) { writeSync(fd, pending); pending = ""; }
    };
    const list = (items: readonly unknown[]): void => {
      items.forEach((item, i) => put(`${i === 0 ? "" : ",\n"}${stringify(item)}`));
      put(items.length === 0 ? "" : "\n");
    };
    put(`${stringify(head).slice(0, -1)}${Object.keys(head).length === 0 ? "" : ","}"records":[\n`);
    list(records);
    put(`],"history":[\n`);
    list(history);
    if (media !== undefined) {
      put(`],"media":[\n`);
      list(media);
    }
    put("]}\n");
    if (pending.length > 0) writeSync(fd, pending);
  } finally {
    closeSync(fd);
  }
}

export async function readBackup(file: string): Promise<ProjectSnapshot> {
  let snapshot: ProjectSnapshot | undefined;
  let list: "records" | "history" | "media" | undefined;
  for await (const line of createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity })) {
    if (snapshot === undefined) {
      if (!line.endsWith(`"records":[`)) return JSON.parse(line) as ProjectSnapshot;
      snapshot = { ...JSON.parse(`${line.slice(0, -`"records":[`.length).replace(/,$/, "")}}`), records: [], history: [] } as ProjectSnapshot;
      list = "records";
    } else if (line === `],"history":[`) list = "history";
    else if (line === `],"media":[`) [list, snapshot.media] = ["media", []];
    else if (line === "]}") list = undefined;
    else if (list !== undefined) snapshot[list]!.push(JSON.parse(line.endsWith(",") ? line.slice(0, -1) : line));
    else if (line !== "") throw new Error(`Not a snapshot file: ${file}`);
  }
  if (snapshot === undefined || list !== undefined) throw new Error(`Snapshot file is not whole: ${file}`);
  return snapshot;
}

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

export function keepBackups(options: {
  storytree: Pick<Storytree, "listProjects" | "snapshot">;
  dir: string;
  log: (message: string) => void;
}) {
  let taking = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
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

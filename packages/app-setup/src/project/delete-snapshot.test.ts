import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ProjectSnapshot, Storytree } from "@storytree/library";
import { deleteProject } from "./index.js";

const project = "synthetic";
const now = new Date("2026-10-08T00:00:00.000Z");
const stamp = "2026-10-08T00-00-00-000Z.json";
const snapshot: ProjectSnapshot = {
  format: "storytree-project-snapshot", version: 1, project, takenAt: now.toISOString(),
  records: [{ id: "term_synthetic", type: "term", version: 1, fields: { meaning: "private current text" }, createdAt: "now", updatedAt: "now" }],
  history: [{ seq: 1, recordId: "term_synthetic", type: "term", action: "created", record: { meaning: "private historical text" }, at: "then" }],
};
const posix = { skip: process.platform === "win32" ? "POSIX modes do not prove Windows ACL privacy" : false };
const mode = (file: string): number => fs.statSync(file).mode & 0o777;

/** Only the library boundary is inert: the real deletion, claims and local removal paths run. */
function inertLibrary(liveClaim = false) {
  const calls = { snapshots: 0, drops: 0 };
  const query = async () => ({ rows: [], rowCount: 0 });
  const client = { query, release() {} };
  const pool = {
    connect: async () => client,
    query: async (sql: string) => ({ rows: liveClaim && sql.includes("FROM activity") ? [{
      seq: "1", project, at: new Date(), session: "synthetic-holder", harness: null, source: "tool", kind: "claimed", folder: null,
      detail: { capability: "capability_synthetic", reason: "synthetic work" },
    }] : [], rowCount: 0 }),
  };
  const library = {
    listProjects: async () => [project],
    projectIdentities: async () => ({ [project]: "synthetic-database" }),
    ownDatabase: async () => pool,
    snapshot: async () => { calls.snapshots++; return snapshot; },
    dropProject: async () => { calls.drops++; },
  } as unknown as Storytree;
  return { library, calls };
}

for (const existing of [false, true]) {
  test(`3.6 · deletion snapshots are private at the first write under umask 022 with ${existing ? "existing" : "new"} backup folders`, posix, async (t) => {
    const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-delete-privacy-"));
    const previousMask = process.umask(0o022);
    t.after(() => { process.umask(previousMask); fs.rmSync(home, { recursive: true, force: true }); });
    fs.chmodSync(home, 0o755);
    const backups = path.join(home, "backups"), folder = path.join(backups, project), file = path.join(folder, stamp);
    if (existing) {
      fs.mkdirSync(folder, { recursive: true });
      for (const dir of [backups, folder]) fs.chmodSync(dir, 0o755);
    }
    const { library, calls } = inertLibrary();
    const write = fs.writeFileSync;
    let observed = false;
    const observe: typeof write = (target, data, options) => {
      write(target, data, options);
      if (target !== file) return;
      observed = true;
      assert.equal(mode(file), 0o600, "snapshot bytes are private as soon as written");
      for (const dir of [backups, folder]) assert.equal(mode(dir), 0o700, dir);
      assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), snapshot);
      assert.equal(calls.drops, 0, "snapshot completes before deletion");
    };
    const mock = t.mock.method(fs, "writeFileSync", observe);
    syncBuiltinESMExports();
    t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });

    assert.deepEqual(await deleteProject(project, { home, library, now, confirm: project, snapshot: true }), { status: "deleted", project, snapshot: file });
    assert.equal(observed, true);
    assert.deepEqual(calls, { snapshots: 1, drops: 1 });
    assert.equal(mode(home), 0o755, "the rest of the home is left alone");
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), snapshot);
  });
}

test("3.6 · wrong confirmation, either in-use project and a live claim write no snapshot and delete nothing; skipping the snapshot still deletes", async (t) => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-delete-controls-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const refusal of ["confirmation", "folder", "app", "claim"]) {
    const { library, calls } = inertLibrary(refusal === "claim");
    fs.writeFileSync(path.join(home, "project-choice.json"), JSON.stringify({ current: refusal === "app" ? project : "elsewhere" }));
    const result = await deleteProject(project, {
      home, library, now, snapshot: true, confirm: refusal === "confirmation" ? "wrong" : project,
      ...(refusal === "folder" ? { inUse: project } : {}),
    });
    assert.equal(result.status, "refused", refusal);
    assert.deepEqual(calls, { snapshots: 0, drops: 0 }, refusal);
    assert.equal(fs.existsSync(path.join(home, "backups")), false, refusal);
  }
  const { library, calls } = inertLibrary();
  assert.deepEqual(await deleteProject(project, { home, library, now, snapshot: false, confirm: project }), { status: "deleted", project });
  assert.deepEqual(calls, { snapshots: 0, drops: 1 });
  assert.equal(fs.existsSync(path.join(home, "backups")), false);
});

test("3.6 · a colliding snapshot is preserved and prevents deletion", async (t) => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-delete-collision-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const folder = path.join(home, "backups", project), file = path.join(folder, stamp);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, "existing snapshot");
  const { library, calls } = inertLibrary();
  await assert.rejects(deleteProject(project, { home, library, now, snapshot: true, confirm: project }), { code: "EEXIST" });
  assert.equal(fs.readFileSync(file, "utf8"), "existing snapshot");
  assert.equal(calls.drops, 0);
});

test("3.6 · a linked backup folder cannot redirect the snapshot or change another folder's permissions", posix, async (t) => {
  const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-delete-link-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const outside = path.join(home, "unrelated"), backups = path.join(home, "backups");
  fs.mkdirSync(outside);
  fs.chmodSync(outside, 0o755);
  for (const link of [backups, path.join(backups, project)]) {
    fs.symlinkSync(outside, link);
    const { library, calls } = inertLibrary();
    await assert.rejects(deleteProject(project, { home, library, now, snapshot: true, confirm: project }), /not a directory/);
    assert.equal(mode(outside), 0o755);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(calls.drops, 0);
    fs.unlinkSync(link);
    fs.mkdirSync(backups, { recursive: true });
  }
});

const windowsOnly = { skip: process.platform !== "win32" ? "Windows Authz effective-access proof runs on Windows CI" : false };

for (const existing of [false, true]) {
  test(`3.6 · Windows excludes an unrelated user before the first deletion snapshot byte with ${existing ? "existing" : "new"} backup folders`, windowsOnly, async (t) => {
    const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-delete-['é] $-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const backups = path.join(home, "backups"), folder = path.join(backups, project), file = path.join(folder, stamp);
    const outside = path.join(home, "unrelated.txt"), notes = path.join(folder, "notes.txt");
    fs.writeFileSync(outside, "unrelated home data");
    const permissive = [home, outside];
    if (existing) {
      fs.mkdirSync(folder, { recursive: true });
      permissive.push(backups, folder);
    }
    allowUnrelated(permissive);
    if (existing) fs.writeFileSync(notes, "unrelated notes");
    for (const row of access(permissive)) assert.ok(row.stranger & 1, `control: unrelated user initially reads/lists ${row.file}`);
    const untouched = [home, outside, ...(existing ? [notes] : [])];
    const before = access(untouched);
    const { library, calls } = inertLibrary();
    const write = fs.writeFileSync;
    let observed = false;
    const mock = t.mock.method(fs, "writeFileSync", ((target, data, options) => {
      if (target === file) {
        assert.equal(fs.statSync(file).size, 0, "the exclusive snapshot has its ACL before any bytes");
        assertPrivate([backups, folder, file]);
        assert.equal(calls.drops, 0);
        observed = true;
      }
      write(target, data, options);
    }) as typeof write);
    syncBuiltinESMExports();
    t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
    assert.deepEqual(await deleteProject(project, { home, library, now, confirm: project, snapshot: true }), { status: "deleted", project, snapshot: file });
    assert.equal(observed, true);
    assert.deepEqual(calls, { snapshots: 1, drops: 1 });
    assertPrivate([backups, folder, file]);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), snapshot, "same-user access preserves all records and history");
    assert.deepEqual(access(untouched), before, "unrelated home and child permissions stay untouched");
    if (existing) assert.equal(fs.readFileSync(notes, "utf8"), "unrelated notes");
  });
}

for (const operation of ["directories", "snapshot"] as const) {
  test(`3.6 · Windows ${operation} ACL refusal prevents snapshot bytes and project removal`, async (t) => {
    const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-delete-acl-refusal-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const { library, calls } = inertLibrary();
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    t.after(() => Object.defineProperty(process, "platform", platform));
    let permissions = 0;
    const mock = t.mock.method(childProcess, "execFileSync", () => {
      if (++permissions === 1 && operation === "snapshot") return Buffer.alloc(0);
      throw new Error("synthetic ACL refusal");
    });
    syncBuiltinESMExports();
    t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
    await assert.rejects(deleteProject(project, { home, library, now, confirm: project, snapshot: true }), /synthetic ACL refusal/);
    assert.equal(calls.drops, 0);
    assert.equal(fs.existsSync(path.join(home, "backups", project, stamp)), false);
    assert.equal(fs.existsSync(path.join(home, "removed-projects.json")), false, "local project removal has not begun");
  });
}

function powershell(script: string, files: string[]): string {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PSMODULEPATH") delete env[key];
  const body = `$ErrorActionPreference = 'Stop'\n[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)\n[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n$files = ConvertFrom-Json ([Console]::In.ReadToEnd())\n${script}`;
  return childProcess.execFileSync(path.join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(body, "utf16le").toString("base64")],
    { input: JSON.stringify(files), env, encoding: "utf8", windowsHide: true, timeout: 30_000 });
}

function allowUnrelated(files: string[]): void {
  powershell(`foreach ($file in $files) {
    $directory = [IO.Directory]::Exists($file)
    $acl = if ($directory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
    $acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = if ($directory) { 'ContainerInherit,ObjectInherit' } else { 'None' }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'), 'FullControl', $inherit, 'None', 'Allow'))
    if ($directory) { [IO.Directory]::SetAccessControl($file, $acl) } else { [IO.File]::SetAccessControl($file, $acl) }
  }`, files);
}

type Access = { file: string; owner: number; stranger: number; sddl: string };
function assertPrivate(files: string[]): void {
  for (const row of access(files)) {
    assert.equal(row.stranger & 0x40003, 0, `the unrelated user cannot read/list, write, or change the DACL: ${row.file}`);
    assert.equal(row.owner & 0x40003, 0x40003, `the same user retains read, write and DACL access: ${row.file}`);
  }
}

/** Ask Windows' authorization engine about the actual on-disk descriptors. The unrelated user
 * is an arbitrary SID with Everyone, Authenticated Users and BUILTIN Users groups, no administrator
 * group or privileges. No account, password, logon, machine policy or service is created/changed.
 * https://learn.microsoft.com/windows/win32/api/authz/nf-authz-authzinitializecontextfromsid
 */
function access(files: string[]): Access[] {
  return JSON.parse(powershell(`Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
public static class DeletionSnapshotAccess {
  [StructLayout(LayoutKind.Sequential)] struct Luid { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct Request { public uint Desired; public IntPtr Self, Types; public uint Count; public IntPtr Optional; }
  [StructLayout(LayoutKind.Sequential)] struct Reply { public uint Count; public IntPtr Granted, Sacl, Error; }
  [DllImport("authz.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool AuthzInitializeResourceManager(uint flags, IntPtr access, IntPtr compute, IntPtr free, string name, out IntPtr manager);
  [DllImport("authz.dll", SetLastError=true)] static extern bool AuthzInitializeContextFromSid(uint flags, byte[] sid, IntPtr manager, IntPtr expiry, Luid id, IntPtr args, out IntPtr context);
  [DllImport("authz.dll", SetLastError=true)] static extern bool AuthzAddSidsToContext(IntPtr context, SidAndAttributes[] groups, uint count, IntPtr restricted, uint restrictedCount, out IntPtr result);
  [DllImport("authz.dll", SetLastError=true)] static extern bool AuthzAccessCheck(uint flags, IntPtr context, ref Request request, IntPtr audit, byte[] descriptor, IntPtr descriptors, uint count, ref Reply reply, IntPtr results);
  [DllImport("authz.dll")] static extern bool AuthzFreeContext(IntPtr context);
  [DllImport("authz.dll")] static extern bool AuthzFreeResourceManager(IntPtr manager);
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static byte[] Sid(string text) { var sid = new SecurityIdentifier(text); var bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0); return bytes; }
  public static uint Allowed(byte[] descriptor, string identity) {
    IntPtr manager = IntPtr.Zero, initial = IntPtr.Zero, context = IntPtr.Zero;
    var groups = new SidAndAttributes[3];
    var result = Marshal.AllocHGlobal(12);
    try {
      Check(AuthzInitializeResourceManager(1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, "deletion snapshot privacy test", out manager));
      // AUTHZ_SKIP_TOKEN_GROUPS: synthetic identity; no account lookup or S4U logon.
      Check(AuthzInitializeContextFromSid(2, Sid(identity), manager, IntPtr.Zero, new Luid(), IntPtr.Zero, out initial));
      var names = new[] { "S-1-1-0", "S-1-5-11", "S-1-5-32-545" };
      for (int i = 0; i < names.Length; i++) {
        var bytes = Sid(names[i]);
        groups[i].Sid = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, groups[i].Sid, bytes.Length);
        groups[i].Attributes = 7; // mandatory, enabled-by-default, enabled
      }
      Check(AuthzAddSidsToContext(initial, groups, 3, IntPtr.Zero, 0, out context));
      var request = new Request { Desired = 0x02000000 }; // MAXIMUM_ALLOWED; no generic bits
      var reply = new Reply { Count = 1, Granted = result, Sacl = IntPtr.Add(result, 4), Error = IntPtr.Add(result, 8) };
      Check(AuthzAccessCheck(0, context, ref request, IntPtr.Zero, descriptor, IntPtr.Zero, 0, ref reply, IntPtr.Zero));
      int error = Marshal.ReadInt32(reply.Error);
      if (error != 0 && error != 5) throw new Win32Exception(error);
      return (uint)Marshal.ReadInt32(reply.Granted);
    } finally {
      if (context != IntPtr.Zero) AuthzFreeContext(context);
      if (initial != IntPtr.Zero) AuthzFreeContext(initial);
      if (manager != IntPtr.Zero) AuthzFreeResourceManager(manager);
      foreach (var group in groups) if (group.Sid != IntPtr.Zero) Marshal.FreeHGlobal(group.Sid);
      Marshal.FreeHGlobal(result);
    }
  }
}
'@
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$stranger = 'S-1-5-21-131313131-242424242-353535353-4242'
if ($owner -eq $stranger) { throw 'test identities must differ' }
$rows = @(foreach ($file in $files) {
  $acl = Get-Acl -LiteralPath $file
  $descriptor = $acl.GetSecurityDescriptorBinaryForm()
  @{ file = $file; owner = [DeletionSnapshotAccess]::Allowed($descriptor, $owner); stranger = [DeletionSnapshotAccess]::Allowed($descriptor, $stranger); sddl = $acl.Sddl }
})
ConvertTo-Json -InputObject $rows -Compress`, files)) as Access[];
}

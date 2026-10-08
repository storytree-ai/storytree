import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ProjectSnapshot } from "@storytree/library";
import { backUp, keepBackups } from "./backups.js";

const snapshot: ProjectSnapshot = {
  format: "storytree-project-snapshot", version: 1, project: "synthetic", takenAt: "2026-10-08T00:00:00.000Z",
  records: [{ id: "term_private", type: "term", version: 1, fields: { meaning: "private current text" }, createdAt: "now", updatedAt: "now" }],
  history: [{ seq: 1, recordId: "term_private", type: "term", action: "created", record: { meaning: "private historical text" }, at: "then" }],
};
const stamp = "2026-10-08T00-00-00-000Z.json";
const windowsOnly = { skip: process.platform !== "win32" ? "platform:win32: Windows Authz effective-access proof runs on Windows CI" : false };

for (const existing of [false, true]) {
  test(`1.8 · Windows excludes an unrelated user before the first snapshot byte with ${existing ? "existing" : "new"} backup folders`, windowsOnly, async (t) => {
    const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-backup-['é] $-"));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const dir = path.join(home, "backups"), folder = path.join(dir, "synthetic");
    const outside = path.join(home, "unrelated.txt");
    fs.writeFileSync(outside, "unrelated home data");
    const retained = path.join(folder, "2026-10-07T00-00-00-000Z.json");
    const stale = `${retained}.partial`;
    const before = [home, outside];
    if (existing) {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(retained, JSON.stringify(snapshot) + "\n");
      fs.writeFileSync(stale, "interrupted");
      before.push(dir, folder, retained, stale);
    }
    allowUnrelated(before);
    const notes = path.join(folder, "notes.txt");
    // Keep an unprotected unrelated child too: changing a directory via SetAccessControl would
    // remove its inherited grants. The repair must touch only the named backup objects.
    if (existing) fs.writeFileSync(notes, "unrelated notes");
    const original = access(before);
    const originalNotes = existing ? access([notes]) : [];
    for (const row of original) assert.ok(row.stranger & 1, `the unrelated user can initially read/list ${row.file}`);
    const write = fs.writeFileSync;
    let observed = false;
    const mock = t.mock.method(fs, "writeFileSync", ((file, data, options) => {
      const partial = String(file);
      assert.equal(fs.statSync(partial).size, 0, "the ACL is installed on the exclusive empty partial before any bytes");
      assertPrivate([dir, folder, partial, ...(existing ? [retained] : [])]);
      assert.equal(fs.existsSync(path.join(folder, stamp)), false, "publication waits for a complete snapshot");
      write(file, data, options);
      assert.deepEqual(JSON.parse(fs.readFileSync(partial, "utf8")), snapshot);
      observed = true;
    }) as typeof write);
    syncBuiltinESMExports();
    t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
    const written = await backUp({ dir, projects: ["synthetic"], now: new Date(snapshot.takenAt), storytree: { snapshot: async () => snapshot } });
    assert.equal(observed, true);
    assert.deepEqual(written, [path.join(folder, stamp)]);
    assertPrivate(written);
    assert.deepEqual(JSON.parse(fs.readFileSync(written[0]!, "utf8")), snapshot, "records and history survive publication");
    assert.equal(fs.readdirSync(folder).some(file => file.endsWith(".partial")), false);
    if (existing) {
      assert.deepEqual(JSON.parse(fs.readFileSync(retained, "utf8")), snapshot);
      assert.deepEqual(access([notes]), originalNotes, "unrelated child permissions stay untouched");
      assert.equal(fs.readFileSync(notes, "utf8"), "unrelated notes");
    }
    assert.deepEqual(access([home, outside]), original.slice(0, 2), "unrelated home permissions stay untouched");
    assert.equal(fs.readFileSync(outside, "utf8"), "unrelated home data");
  });
}

test("1.8 · Windows repairs retained snapshots before freshness reuse, including removed projects and partials", windowsOnly, async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.parse("2026-10-08T01:00:00.000Z") });
  const home = fs.mkdtempSync(path.join(tmpdir(), "storytree-backup-acl-retained-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, "backups"), owned: string[] = [dir];
  const files: string[] = [];
  for (const project of ["fresh", "gone"]) {
    const folder = path.join(dir, project);
    fs.mkdirSync(folder, { recursive: true });
    owned.push(folder);
    for (const suffix of ["", ".partial"]) {
      const file = path.join(folder, stamp + suffix);
      fs.writeFileSync(file, JSON.stringify(snapshot) + "\n");
      owned.push(file);
      files.push(file);
    }
  }
  allowUnrelated([home, ...owned]);
  for (const row of access(owned)) assert.ok(row.stranger & 1, "retained data starts effectively readable");
  const logs: string[] = [];
  let taken = 0;
  const backups = keepBackups({ dir, log: line => logs.push(line), storytree: {
    listProjects: async () => { assertPrivate(owned); return ["fresh"]; },
    snapshot: async () => { taken++; return snapshot; },
  } });
  t.after(() => backups.stop());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(logs, []);
  assert.equal(taken, 0, "privacy repair preserves startup freshness reuse");
  assert.equal(backups.canRestart(), true);
  for (const file of files) assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), snapshot);
});

test("1.8 · a Windows permission failure prevents snapshot bytes and freshness reuse", async (t) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "storytree-backup-acl-failure-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: "win32" });
  t.after(() => Object.defineProperty(process, "platform", platform));
  const mock = t.mock.method(childProcess, "execFileSync", () => { throw new Error("synthetic ACL refusal"); });
  syncBuiltinESMExports();
  t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
  await assert.rejects(backUp({ dir, projects: ["synthetic"], storytree: { snapshot: async () => snapshot } }), /synthetic ACL refusal/);
  assert.deepEqual(fs.readdirSync(dir), [], "no snapshot bytes are written when privacy could not be established");
  const logs: string[] = [];
  let listed = false;
  const backups = keepBackups({ dir, log: line => logs.push(line), storytree: {
    listProjects: async () => { listed = true; return []; }, snapshot: async () => snapshot,
  } });
  t.after(() => backups.stop());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(listed, false, "startup must not reach freshness reuse after a permission refusal");
  assert.deepEqual(logs, ["backups: synthetic ACL refusal"]);
  assert.equal(backups.canRestart(), true);
});

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
public static class BackupAccess {
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
      Check(AuthzInitializeResourceManager(1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, "backup privacy test", out manager));
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
  @{ file = $file; owner = [BackupAccess]::Allowed($descriptor, $owner); stranger = [BackupAccess]::Allowed($descriptor, $stranger); sddl = $acl.Sddl }
})
ConvertTo-Json -InputObject $rows -Compress`, files)) as Access[];
}

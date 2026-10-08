import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { makeDevHome, removeDevHome } from "./dev-home.js";

const original = '{"refresh":"synthetic-original"}';
const refreshed = '{"refresh":"synthetic-refreshed"}';
const conflicting = '{"refresh":"synthetic-conflicting"}';
const stopBeforeBuild = async () => { throw new Error("stopped before build"); };
const windowsOnly = { skip: process.platform !== "win32" ? "platform:win32: Windows Authz effective-access proof runs on Windows CI" : false };

for (const permissive of [false, true]) {
  test(`2.8 · Windows developer-home sign-ins are private at first write under ${permissive ? "permissive" : "default"} parents`, windowsOnly, async (t) => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "storytree-dev-['é] $-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    if (permissive) allowUnrelated([root]);
    const codex = path.join(root, "source");
    fs.mkdirSync(codex);
    const source = path.join(codex, "auth.json");
    fs.writeFileSync(source, original);
    const before = access([root, codex, source]);
    if (permissive) {
      // The old mkdir/write mode options alone leave inherited Windows access intact.
      fs.chmodSync(source, 0o600);
      assert.ok(access([source])[0]!.stranger & 1, "control: POSIX mode leaves the synthetic sign-in readable on Windows");
    }
    const dir = path.join(root, "dev");
    const home = path.join(dir, "home"), insideHome = path.join(home, ".codex");
    const inside = path.join(insideHome, "auth.json"), marker = path.join(dir, "storytree-dev-home.json");
    const write = fs.writeFileSync;
    let observed = false;
    const mock = t.mock.method(fs, "writeFileSync", ((file, data, options) => {
      if (String(file) === inside) {
        assertPrivate([dir, home, insideHome]);
        observed = true;
      }
      write(file, data, options);
      if (String(file) === inside || String(file) === marker) assertPrivate([String(file)]);
    }) as typeof write);
    syncBuiltinESMExports();
    t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
    await assert.rejects(makeDevHome({ dir, harnesses: ["codex"], signedIn: { codex }, build: stopBeforeBuild }), /stopped before build/);
    assert.equal(observed, true);
    assert.equal(fs.readFileSync(inside, "utf8"), original);
    assert.equal(fs.readFileSync(marker, "utf8").includes("synthetic-original"), false);
    assert.deepEqual(access([root, codex, source]), before, "copying leaves source and parent permissions unchanged");
    await removeDevHome(dir);
    assert.equal(fs.readFileSync(source, "utf8"), original);
  });
}

for (const conflict of [false, true]) {
  test(`2.8 · Windows repairs legacy homes and protects refreshed hand-back with ${conflict ? "conflicting" : "unchanged"} source sign-in`, windowsOnly, async (t) => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "storytree-dev-refresh-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    allowUnrelated([root]);
    const codex = path.join(root, "source");
    fs.mkdirSync(codex);
    const source = path.join(codex, "auth.json"), settings = path.join(codex, "config.toml");
    fs.writeFileSync(source, original);
    fs.writeFileSync(settings, "unrelated settings");
    const before = access([root, codex, settings]);
    const dir = path.join(root, "dev"), home = path.join(dir, "home"), insideHome = path.join(home, ".codex");
    const inside = path.join(insideHome, "auth.json"), marker = path.join(dir, "storytree-dev-home.json");
    await assert.rejects(makeDevHome({ dir, harnesses: ["codex"], signedIn: { codex }, build: stopBeforeBuild }), /stopped before build/);
    fs.writeFileSync(marker, JSON.stringify({ made: "2026-10-08", codexSignIn: { from: source, copied: original } }));
    fs.writeFileSync(inside, refreshed);
    if (conflict) fs.writeFileSync(source, conflicting);
    const owned = [dir, home, insideHome, marker, inside];
    allowUnrelated(owned);
    for (const row of access([...owned, source])) assert.ok(row.stranger & 1, "control: legacy and source sign-ins start readable");
    const sourceBefore = access([source]);
    const write = fs.writeFileSync;
    let handedBack = false;
    const mock = t.mock.method(fs, "writeFileSync", ((file, data, options) => {
      if (String(file) === marker) assertPrivate(owned);
      if (String(file) === source) {
        assertPrivate([source]);
        handedBack = true;
      }
      write(file, data, options);
    }) as typeof write);
    syncBuiltinESMExports();
    t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
    if (conflict) {
      await assert.rejects(removeDevHome(dir), /changed meanwhile/);
      assert.equal(handedBack, false);
      assert.equal(fs.readFileSync(inside, "utf8"), refreshed);
      assert.equal(fs.readFileSync(source, "utf8"), conflicting);
      assert.deepEqual(access([source]), sourceBefore, "conflicting source sign-in is untouched");
      assertPrivate(owned);
      assert.equal(fs.readFileSync(marker, "utf8").includes("synthetic-original"), false);
      write(source, original);
    }
    await removeDevHome(dir);
    assert.equal(handedBack, true);
    assertPrivate([source]);
    assert.equal(fs.readFileSync(source, "utf8"), refreshed);
    assert.equal(fs.existsSync(dir), false);
    assert.deepEqual(access([root, codex, settings]), before, "hand-back leaves unrelated source settings and ACLs unchanged");
    assert.equal(fs.readFileSync(settings, "utf8"), "unrelated settings");
  });
}

for (const operation of ["copy", "hand-back"] as const) {
  test(`2.8 · Windows permission refusal prevents sign-in ${operation}`, async (t) => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "storytree-dev-acl-refusal-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const codex = path.join(root, "source"), dir = path.join(root, "dev");
    fs.mkdirSync(codex);
    const source = path.join(codex, "auth.json"), inside = path.join(dir, "home", ".codex", "auth.json");
    fs.writeFileSync(source, original);
    if (operation === "hand-back") {
      await assert.rejects(makeDevHome({ dir, harnesses: ["codex"], signedIn: { codex }, build: stopBeforeBuild }), /stopped before build/);
      fs.writeFileSync(inside, refreshed);
    }
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "win32" });
    t.after(() => Object.defineProperty(process, "platform", platform));
    let calls = 0;
    const mock = t.mock.method(childProcess, "execFileSync", () => {
      // Let legacy-home repair finish so the hand-back refusal is exercised at the
      // source file itself, immediately before it would receive refreshed bytes.
      if (++calls === 1 && operation === "hand-back") return Buffer.alloc(0);
      throw new Error("synthetic ACL refusal");
    });
    syncBuiltinESMExports();
    t.after(() => { mock.mock.restore(); syncBuiltinESMExports(); });
    await assert.rejects(operation === "copy"
      ? makeDevHome({ dir, harnesses: ["codex"], signedIn: { codex }, build: stopBeforeBuild })
      : removeDevHome(dir), /synthetic ACL refusal/);
    assert.equal(fs.readFileSync(source, "utf8"), original);
    if (operation === "copy") assert.equal(fs.existsSync(inside), false, "no new sign-in on a permission failure");
    else assert.equal(fs.readFileSync(inside, "utf8"), refreshed, "the refreshed sign-in remains recoverable");
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
public static class DevHomeAccess {
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
      Check(AuthzInitializeResourceManager(1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, "developer home privacy test", out manager));
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
  @{ file = $file; owner = [DevHomeAccess]::Allowed($descriptor, $owner); stranger = [DevHomeAccess]::Allowed($descriptor, $stranger); sddl = $acl.Sddl }
})
ConvertTo-Json -InputObject $rows -Compress`, files)) as Access[];
}

/** Capability 1.16 · Read the local-postgres producer's private connection handoff. */
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from "node:fs";
import path from "node:path";

export interface LocalOwner {
  pid: number;
  port: number;
  token?: unknown;
  auth?: unknown;
}

/** A connection failure only: callers must not confuse this with app liveness. No material is echoed. */
export const HANDOFF_UNAVAILABLE = "storytree's local database credentials are unavailable or invalid; restart the storytree app to repair its connection handoff";

/**
 * Undefined means an old installation with neither auth metadata nor an auth directory. Any
 * evidence of authentication commits the reader to that path: failures never become legacy URLs.
 * See contract 1.16 and the increment's producer handoff in the library.
 */
export function authenticatedLocalUrl(dataDir: string, owner: LocalOwner): string | undefined {
  const directory = `${path.resolve(dataDir)}.auth`;
  if (!Object.hasOwn(owner, "auth")) {
    try { lstatSync(directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error(HANDOFF_UNAVAILABLE);
    }
    throw new Error(HANDOFF_UNAVAILABLE);
  }
  const auth = owner.auth;
  if (!object(auth) || auth.version !== 1 || auth.method !== "scram-sha-256" || !identifier(auth.installationId) || !identifier(owner.token)) {
    throw new Error(HANDOFF_UNAVAILABLE);
  }
  const file = path.join(directory, "connection.json");
  const dirStat = lstatSync(directory);
  const fileStat = lstatSync(file);
  if (!dirStat.isDirectory() || !fileStat.isFile() || fileStat.nlink !== 1) throw new Error(HANDOFF_UNAVAILABLE);
  if (process.platform === "win32") windowsPrivate(directory, file);
  else {
    posixPrivate(dirStat, true);
    posixPrivate(fileStat, false);
    if (process.platform === "darwin") {
      // macOS ACL grants can exceed mode bits. Refuse extended ACLs instead of assuming 0600
      // means private. Linux's POSIX ACL mask is reflected in the group mode bits checked above.
      const listing = execFileSync("/bin/ls", ["-lde", directory, file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 3000 });
      if (listing.split("\n").some((line) => /^[d-][rwxstST-]{9}\+|^\s*\d+: /.test(line))) throw new Error(HANDOFF_UNAVAILABLE);
    }
  }
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== fileStat.ino || opened.dev !== fileStat.dev || opened.size > 16_384) throw new Error(HANDOFF_UNAVAILABLE);
    if (process.platform !== "win32") posixPrivate(opened, false);
    const bytes = Buffer.alloc(16_385);
    const length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length > 16_384) throw new Error(HANDOFF_UNAVAILABLE);
    const credentials: unknown = JSON.parse(bytes.subarray(0, length).toString("utf8"));
    if (!object(credentials) || credentials.version !== 1 || credentials.installationId !== auth.installationId ||
      credentials.ownerToken !== owner.token || credentials.port !== owner.port ||
      typeof credentials.user !== "string" || !/^[a-z_][a-z0-9_]{0,62}$/.test(credentials.user) ||
      typeof credentials.password !== "string" || credentials.password.length < 32 || credentials.password.length > 1024 || /[\x00-\x1f\x7f]/.test(credentials.password)) {
      throw new Error(HANDOFF_UNAVAILABLE);
    }
    // Endpoint and database are fixed locally, never accepted from credential JSON.
    return `postgres://${encodeURIComponent(credentials.user)}:${encodeURIComponent(credentials.password)}@127.0.0.1:${owner.port}/postgres`;
  } finally { closeSync(fd); }
}

function posixPrivate(stat: Stats, directory: boolean): void {
  const required = directory ? 0o700 : 0o600;
  if (stat.uid !== process.getuid!() || (stat.mode & 0o777) !== required) throw new Error(HANDOFF_UNAVAILABLE);
}

/** Check actual SIDs, not translated/localized icacls text or Windows' synthetic Unix mode. */
function windowsPrivate(directory: string, file: string): void {
  const script = `
    $ErrorActionPreference = 'Stop'
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $allowed = @($sid, 'S-1-5-18', 'S-1-5-32-544')
    foreach ($item in @($env:STORYTREE_HANDOFF_DIRECTORY, $env:STORYTREE_HANDOFF_FILE)) {
      if ([System.IO.Directory]::Exists($item)) { $acl = [System.IO.Directory]::GetAccessControl($item) }
      else { $acl = [System.IO.File]::GetAccessControl($item) }
      if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid) { exit 1 }
      if (-not $acl.AreAccessRulesProtected) { exit 1 }
      $own = $false
      foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow') {
          if ($rule.IdentityReference.Value -notin $allowed) { exit 1 }
          if ($rule.IdentityReference.Value -eq $sid -and -not ($rule.PropagationFlags -band 2)) { $own = $true }
        }
      }
      if (-not $own) { exit 1 }
    }
    [Console]::WriteLine('private')
  `;
  const output = execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { env: { ...process.env, STORYTREE_HANDOFF_DIRECTORY: directory, STORYTREE_HANDOFF_FILE: file }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000 });
  if (output.trim() !== "private") throw new Error(HANDOFF_UNAVAILABLE);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

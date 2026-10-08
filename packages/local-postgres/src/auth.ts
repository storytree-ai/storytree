/**
 * Capability 2 · A server on a data directory: its sign-in. Every cluster storytree runs asks for a
 * password (SCRAM-SHA-256) on every connection; nothing is trusted. The password is this
 * installation's own secret, kept beside the data directory in a private directory
 * (`<dataDir>.auth`, readable by this OS user only), and handed to clients there as the versioned
 * connection handoff of ADR-0941 (`<dataDir>.auth/connection.json`), published once the server
 * listens and withdrawn when it stops.
 *
 * Private means: on POSIX the directory is mode 0700 and each file 0600, owned by this user; on
 * Windows each carries a protected access list (no inheritance) granting this user's SID alone,
 * set through the built-in .NET access-control API, since Windows mode bits prove nothing.
 */
import { execFileSync } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, linkSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The installation's sign-in, kept in `<dataDir>.auth/installation.json`. */
export interface Installation {
  readonly installationId: string;
  readonly user: string;
  readonly password: string;
}

/** The owner record's `auth` entry: says a handoff is due, never carries the secret. */
export interface AuthMarker {
  readonly version: 1;
  readonly method: "scram-sha-256";
  readonly installationId: string;
}

/** The superuser every storytree cluster is made with, as its clients sign in. */
const USER = "postgres";

export function authDir(dataDir: string): string {
  return `${dataDir}.auth`;
}

export function authMarker(installation: Installation): AuthMarker {
  return { version: 1, method: "scram-sha-256", installationId: installation.installationId };
}

/** The connection url for `installation` on `port`, its password included. */
export function connectionUrl(installation: Installation, port: number): string {
  return `postgres://${encodeURIComponent(installation.user)}:${encodeURIComponent(installation.password)}@127.0.0.1:${port}/postgres`;
}

/**
 * This installation's sign-in: read from its private directory, or made there the first time
 * (written whole by a hard link, so two starters agree on one secret). The directory is made
 * private, or refused when it is not this user's own real directory.
 */
export function ensureInstallation(dataDir: string): Installation {
  const dir = privateDir(dataDir);
  const file = path.join(dir, "installation.json");
  const existing = readInstallation(file);
  if (existing !== undefined) return existing;
  const made: Installation = { installationId: randomUUID(), user: USER, password: randomBytes(32).toString("base64url") };
  const scratch = writePrivate(dir, JSON.stringify({ version: 1, ...made }));
  try {
    linkSync(scratch, file);
  } catch (error) {
    if (!isCode(error, "EEXIST")) throw error;
    const theirs = readInstallation(file);
    if (theirs === undefined) throw new Error(`${file} is not a storytree sign-in; remove ${dir} to make a new one`);
    return theirs;
  } finally {
    rmSync(scratch, { force: true });
  }
  return made;
}

/** Publish the handoff a client reads for the server this process owns: whole, private, and replacing any earlier one. */
export function publishConnection(dataDir: string, installation: Installation, ownerToken: string, port: number): void {
  const dir = privateDir(dataDir);
  const handoff = { version: 1, installationId: installation.installationId, ownerToken, port, user: installation.user, password: installation.password };
  const scratch = writePrivate(dir, JSON.stringify(handoff));
  try {
    renameSync(scratch, path.join(dir, "connection.json"));
  } finally {
    rmSync(scratch, { force: true });
  }
}

/** Withdraw the handoff, if it is still the one published for `ownerToken`. The directory and its sign-in stay. */
export function withdrawConnection(dataDir: string, ownerToken: string): void {
  const file = path.join(authDir(dataDir), "connection.json");
  try {
    const handoff = JSON.parse(readFileSync(file, "utf8")) as { ownerToken?: unknown };
    if (handoff.ownerToken === ownerToken) rmSync(file, { force: true });
  } catch {
    // none, or not readable as ours: leave it
  }
}

/**
 * The SCRAM-SHA-256 verifier Postgres stores for `password` (RFC 7677, as Postgres writes it).
 * Handing the server this instead of the password keeps the secret itself out of its input.
 */
export function scramVerifier(password: string): string {
  const salt = randomBytes(16);
  const iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** Write `text` to a fresh private file in `dir`; the caller links or renames it into place. */
export function writePrivate(dir: string, text: string): string {
  const file = path.join(dir, `.${process.pid}.${randomUUID()}.tmp`);
  writeFileSync(file, text, { flag: "wx", mode: 0o600 });
  try {
    if (process.platform === "win32") protectWindows([file]);
    else chmodSync(file, 0o600);
  } catch (error) {
    rmSync(file, { force: true });
    throw error;
  }
  return file;
}

/** `<dataDir>.auth`, made private if new, and checked to be this user's own real directory. */
function privateDir(dataDir: string): string {
  const dir = authDir(dataDir);
  let made = false;
  try {
    mkdirSync(dir, { mode: 0o700 });
    made = true;
  } catch (error) {
    if (!isCode(error, "EEXIST")) throw error;
  }
  const stat = lstatSync(dir);
  if (!stat.isDirectory()) throw new Error(`${dir} is not a directory, so storytree will not keep its database sign-in there`);
  if (process.platform === "win32") {
    if (made) protectWindows([dir]);
  } else {
    if (stat.uid !== process.getuid!()) throw new Error(`${dir} belongs to another user, so storytree will not keep its database sign-in there`);
    if ((stat.mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
  }
  return dir;
}

function readInstallation(file: string): Installation | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isCode(error, "ENOENT")) return undefined;
    throw error;
  }
  try {
    const value = JSON.parse(text) as Partial<Installation> & { version?: unknown };
    if (value.version === 1 && typeof value.installationId === "string" && typeof value.user === "string" && typeof value.password === "string") {
      return { installationId: value.installationId, user: value.user, password: value.password };
    }
  } catch {
    // not JSON: refused below
  }
  throw new Error(`${file} is not a storytree sign-in; remove ${path.dirname(file)} to make a new one`);
}

/**
 * Give each path a protected access list granting this user's SID alone, owned by it. Paths go to
 * PowerShell as environment data; no secret does.
 */
function protectWindows(paths: readonly string[]): void {
  const script = `
    $ErrorActionPreference = 'Stop'
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($item in $env:STORYTREE_PRIVATE_PATHS.Split([char]10)) {
      if ([System.IO.Directory]::Exists($item)) {
        $acl = New-Object System.Security.AccessControl.DirectorySecurity
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      } else {
        $acl = New-Object System.Security.AccessControl.FileSecurity
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
      }
      $acl.SetOwner($sid)
      $acl.SetAccessRuleProtection($true, $false)
      $acl.AddAccessRule($rule)
      if ([System.IO.Directory]::Exists($item)) { [System.IO.Directory]::SetAccessControl($item, $acl) }
      else { [System.IO.File]::SetAccessControl($item, $acl) }
    }
  `;
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { env: { ...process.env, STORYTREE_PRIVATE_PATHS: paths.join("\n") }, stdio: ["ignore", "ignore", "pipe"], timeout: 60_000, windowsHide: true });
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

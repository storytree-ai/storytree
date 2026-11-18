// Capability 2 · A server on a data directory
import { execFileSync } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Installation {
  readonly installationId: string;
  readonly user: string;
  readonly password: string;
}

export interface SignIn {
  readonly user: string;
  readonly password: string;
}

export interface AuthMarker {
  readonly version: 1;
  readonly method: "scram-sha-256";
  readonly installationId: string;
}

const USER = "postgres";

export const CLIENT_USER = "storytree";

export function authDir(dataDir: string): string {
  return `${dataDir}.auth`;
}

export function authMarker(installation: Installation): AuthMarker {
  return { version: 1, method: "scram-sha-256", installationId: installation.installationId };
}

export function connectionUrl(signIn: SignIn, port: number, database = "postgres"): string {
  return `postgres://${encodeURIComponent(signIn.user)}:${encodeURIComponent(signIn.password)}@127.0.0.1:${port}/${encodeURIComponent(database)}`;
}

export function ensureInstallation(dataDir: string): Installation {
  return ensureSignInFile(dataDir, "installation.json", () => ({ installationId: randomUUID(), user: USER, password: newPassword() }), readInstallation);
}

export function ensureClientSignIn(dataDir: string): SignIn {
  return ensureSignInFile(dataDir, "client.json", () => ({ user: CLIENT_USER, password: newPassword() }), readClientSignIn);
}

function newPassword(): string {
  return randomBytes(32).toString("base64url");
}

function ensureSignInFile<T extends object>(dataDir: string, name: string, make: () => T, read: (file: string) => T | undefined): T {
  const dir = privateDir(dataDir);
  const file = path.join(dir, name);
  const existing = read(file);
  if (existing !== undefined) return existing;
  const made = make();
  const scratch = writePrivate(dir, JSON.stringify({ version: 1, ...made }));
  try {
    linkSync(scratch, file);
  } catch (error) {
    if (!isCode(error, "EEXIST")) throw error;
    const theirs = read(file);
    if (theirs === undefined) throw new Error(`${file} is not a storytree sign-in; remove ${dir} to make a new one`);
    return theirs;
  } finally {
    rmSync(scratch, { force: true });
  }
  return made;
}

export function publishConnection(dataDir: string, installation: Installation, signIn: SignIn, ownerToken: string, port: number): void {
  const dir = privateDir(dataDir);
  const handoff = { version: 1, installationId: installation.installationId, ownerToken, port, user: signIn.user, password: signIn.password };
  const scratch = writePrivate(dir, JSON.stringify(handoff));
  try {
    renameSync(scratch, path.join(dir, "connection.json"));
  } finally {
    rmSync(scratch, { force: true });
  }
}

export function withdrawConnection(dataDir: string, ownerToken: string): void {
  const file = path.join(authDir(dataDir), "connection.json");
  try {
    const handoff = JSON.parse(readFileSync(file, "utf8")) as { ownerToken?: unknown };
    if (handoff.ownerToken === ownerToken) rmSync(file, { force: true });
  } catch {
  }
}

export function scramVerifier(password: string): string {
  const salt = randomBytes(16);
  const iterations = 4096;
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

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
    if (made || !readdirSync(dir).some((name) => name.endsWith(".json"))) protectWindows([dir]);
  } else {
    if (stat.uid !== process.getuid!()) throw new Error(`${dir} belongs to another user, so storytree will not keep its database sign-in there`);
    if ((stat.mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
  }
  return dir;
}

function readInstallation(file: string): Installation | undefined {
  const value = readSignInFile(file);
  if (value === undefined) return undefined;
  if (typeof value.installationId === "string" && typeof value.user === "string" && typeof value.password === "string") {
    return { installationId: value.installationId, user: value.user, password: value.password };
  }
  throw notASignIn(file);
}

function readClientSignIn(file: string): SignIn | undefined {
  const value = readSignInFile(file);
  if (value === undefined) return undefined;
  if (typeof value.user === "string" && /^[a-z_][a-z0-9_]{0,62}$/.test(value.user) && value.user !== USER && typeof value.password === "string") {
    return { user: value.user, password: value.password };
  }
  throw notASignIn(file);
}

function readSignInFile(file: string): Record<string, unknown> | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (isCode(error, "ENOENT")) return undefined;
    throw error;
  }
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value === "object" && value !== null && (value as { version?: unknown }).version === 1) return value as Record<string, unknown>;
  } catch {
  }
  throw notASignIn(file);
}

function notASignIn(file: string): Error {
  return new Error(`${file} is not a storytree sign-in; remove ${path.dirname(file)} to make a new one`);
}

function protectWindows(paths: readonly string[]): void {
  const script = `
    $ErrorActionPreference = 'Stop'
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($item in $env:STORYTREE_PRIVATE_PATHS.Split([char]10)) {
      if ([System.IO.Directory]::Exists($item)) {
        $owner = [System.IO.Directory]::GetAccessControl($item, 'Owner').GetOwner([System.Security.Principal.SecurityIdentifier])
        $acl = New-Object System.Security.AccessControl.DirectorySecurity
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      } else {
        $owner = [System.IO.File]::GetAccessControl($item, 'Owner').GetOwner([System.Security.Principal.SecurityIdentifier])
        $acl = New-Object System.Security.AccessControl.FileSecurity
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
      }
      if ($owner -ne $sid) { $acl.SetOwner($sid) }
      $acl.SetAccessRuleProtection($true, $false)
      $acl.AddAccessRule($rule)
      if ([System.IO.Directory]::Exists($item)) { [System.IO.Directory]::SetAccessControl($item, $acl) }
      else { [System.IO.File]::SetAccessControl($item, $acl) }
    }
  `;
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { env: { ...process.env, STORYTREE_PRIVATE_PATHS: paths.join("\n") }, stdio: ["ignore", "ignore", "pipe"], timeout: 180_000, windowsHide: true });
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

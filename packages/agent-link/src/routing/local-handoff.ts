/** Capability 1 · Project routing. Read the local-postgres producer's private connection handoff (contract 1.16). */
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface LocalOwner {
  pid: number;
  port: number;
  token?: unknown;
  auth?: unknown;
}

/** A connection failure only: callers must not confuse this with app liveness. No material is echoed. */
export const HANDOFF_UNAVAILABLE = "storytree's local database credentials are unavailable or invalid; restart the storytree app to repair its connection handoff";

type WindowsRefusal = "windows-acl-timeout" | "windows-acl-process" | "windows-acl-owner" |
  "windows-acl-inheritance" | "windows-acl-exposed" | "windows-acl-no-owner-grant" | "windows-acl-output";

/** Only fixed reason codes cross discovery's error boundary; never attach the original cause. */
export class HandoffPrivacyError extends Error {
  constructor(reason: WindowsRefusal) { super(`${HANDOFF_UNAVAILABLE} (${reason})`); }
}

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

// Windows' ADSI security utility returns each path's self-relative security descriptor as hex
// (ADS_PATH_FILE, ADS_SD_FORMAT_HEXSTRING; owner, group and DACL). Windows Script Host starts in
// tens of milliseconds, where a cold Windows PowerShell start once exceeded the deadline.
const DESCRIPTOR_SCRIPT = `
  try {
    var utility = new ActiveXObject("ADsSecurityUtility");
    utility.SecurityMask = 7;
    var env = new ActiveXObject("WScript.Shell").Environment("PROCESS");
    WScript.StdOut.WriteLine(utility.GetSecurityDescriptor(env("STORYTREE_HANDOFF_DIRECTORY"), 1, 3));
    WScript.StdOut.WriteLine(utility.GetSecurityDescriptor(env("STORYTREE_HANDOFF_FILE"), 1, 3));
  } catch (error) { WScript.Quit(1); }
`;
const SYSTEM = "S-1-5-18";
const ADMINISTRATORS = "S-1-5-32-544";

/** Check actual SIDs in the binary descriptors, not translated/localized icacls text or Windows' synthetic Unix mode. */
function windowsPrivate(directory: string, file: string): void {
  const system32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  let scratch: string | undefined;
  let currentSid: string | undefined;
  // One five-second deadline bounds both native children of an attempt.
  const check = () => {
    const started = performance.now();
    const run = (command: string, args: string[], env?: NodeJS.ProcessEnv) => {
      const timeout = Math.floor(5000 - (performance.now() - started));
      if (timeout <= 0) throw Object.assign(new Error("deadline"), { code: "ETIMEDOUT" });
      return execFileSync(path.join(system32, command), args, { env, encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"], timeout, maxBuffer: 65_536, windowsHide: true });
    };
    // Parse only the numeric SID, never localized account names.
    currentSid = run("whoami.exe", ["/user", "/fo", "csv", "/nh"]).match(/,"(S-1-\d+(?:-\d+)+)"\s*$/)?.[1];
    if (currentSid === undefined) throw new HandoffPrivacyError("windows-acl-output");
    return run("cscript.exe", ["//Nologo", "//B", "//E:JScript", path.join(scratch!, "descriptor.js")],
      { ...process.env, STORYTREE_HANDOFF_DIRECTORY: directory, STORYTREE_HANDOFF_FILE: file });
  };
  let output: string;
  try {
    // cscript runs only a script file; it lives in the user's private temp folder for this call.
    scratch = mkdtempSync(path.join(tmpdir(), "storytree-handoff-"));
    writeFileSync(path.join(scratch, "descriptor.js"), DESCRIPTOR_SCRIPT, { mode: 0o600 });
    // A stall once exceeded the deadline on a loaded machine. Retry a timeout once, keeping
    // each attempt's deadline: a second stall refuses.
    try { output = check(); } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== "ETIMEDOUT") throw error;
      output = check();
    }
  } catch (error) {
    if (error instanceof HandoffPrivacyError) throw error;
    throw new HandoffPrivacyError((error as { code?: unknown } | null)?.code === "ETIMEDOUT" ? "windows-acl-timeout" : "windows-acl-process");
  } finally {
    // The script holds no secret; a leftover copy never decides a later check.
    if (scratch) try { rmSync(scratch, { recursive: true, force: true }); } catch { /* left for the OS to clean */ }
  }
  const descriptors = output.trim().split(/\r?\n/);
  if (descriptors.length !== 2) throw new HandoffPrivacyError("windows-acl-output");
  for (const hex of descriptors) {
    const refusal = descriptorRefusal(hex.trim(), currentSid!);
    if (refusal) throw new HandoffPrivacyError(refusal);
  }
}

/** Owner, protected DACL, no foreign allow, and a non-inherit-only grant to the owner, in that order. */
function descriptorRefusal(hex: string, sid: string): WindowsRefusal | undefined {
  if (!/^(?:[0-9a-fA-F]{2}){20,}$/.test(hex)) return "windows-acl-output";
  const sd = Buffer.from(hex, "hex");
  const at = (offset: number, length: number) => {
    if (offset < 0 || offset + length > sd.length) throw new RangeError("descriptor");
    return offset;
  };
  const sidAt = (offset: number) => {
    const count = sd[at(offset, 8) + 1]!;
    at(offset, 8 + 4 * count);
    const authority = sd.readUIntBE(offset + 2, 6);
    const subs = Array.from({ length: count }, (_, i) => sd.readUInt32LE(offset + 8 + 4 * i));
    return { sid: `S-${sd[offset]}-${authority}${subs.map((sub) => `-${sub}`).join("")}`, length: 8 + 4 * count };
  };
  try {
    const control = sd.readUInt16LE(2);
    const ownerOffset = sd.readUInt32LE(4);
    const daclOffset = sd.readUInt32LE(16);
    if (sd[0] !== 1 || !(control & 0x8000)) return "windows-acl-output";
    if (ownerOffset === 0 || sidAt(ownerOffset).sid !== sid) return "windows-acl-owner";
    if (!(control & 0x1000)) return "windows-acl-inheritance";
    // An absent or null DACL grants everyone everything.
    if (!(control & 0x0004) || daclOffset === 0) return "windows-acl-exposed";
    const aceCount = sd.readUInt16LE(at(daclOffset, 8) + 4);
    let own = false;
    for (let i = 0, offset = daclOffset + 8; i < aceCount; i += 1) {
      const [type, flags] = [sd[at(offset, 4)]!, sd[offset + 1]!];
      const size = sd.readUInt16LE(offset + 2);
      if (size < 4) return "windows-acl-output";
      at(offset, size);
      // Plain denies only narrow access. Any other kind of entry (object, callback, compound
      // or unknown) is refused rather than interpreted.
      if (type === 0) {
        if (size < 16) return "windows-acl-output";
        const trustee = sidAt(offset + 8);
        if (8 + trustee.length > size) return "windows-acl-output";
        if (trustee.sid !== sid && trustee.sid !== SYSTEM && trustee.sid !== ADMINISTRATORS) return "windows-acl-exposed";
        if (trustee.sid === sid && !(flags & 0x08)) own = true;
      } else if (type !== 1) return "windows-acl-exposed";
      offset += size;
    }
    return own ? undefined : "windows-acl-no-owner-grant";
  } catch (error) {
    if (error instanceof RangeError) return "windows-acl-output";
    throw error;
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

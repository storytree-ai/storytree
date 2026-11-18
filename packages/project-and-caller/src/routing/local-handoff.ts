// Capability 1 · Project routing
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from "node:fs";
import path from "node:path";

import { windowsSecurity } from "./windows-security.js";

export interface LocalOwner {
  pid: number;
  port: number;
  token?: unknown;
  auth?: unknown;
}

export const HANDOFF_UNAVAILABLE = "storytree's local database credentials are unavailable or invalid; restart the storytree app to repair its connection handoff";

type WindowsRefusal = "windows-acl-process" | "windows-acl-owner" |
  "windows-acl-inheritance" | "windows-acl-exposed" | "windows-acl-no-owner-grant" | "windows-acl-output";

export class HandoffPrivacyError extends Error {
  constructor(reason: WindowsRefusal) { super(`${HANDOFF_UNAVAILABLE} (${reason})`); }
}

export function authenticatedLocalUrl(dataDir: string, owner: LocalOwner): string {
  const directory = `${path.resolve(dataDir)}.auth`;
  const auth = owner.auth;
  if (!object(auth) || auth.version !== 1 || auth.method !== "scram-sha-256" || !identifier(auth.installationId) || !identifier(owner.token)) {
    throw new Error(HANDOFF_UNAVAILABLE);
  }
  const file = path.join(directory, "connection.json");
  const dirStat = lstatSync(directory);
  const fileStat = lstatSync(file);
  if (!dirStat.isDirectory() || !fileStat.isFile() || fileStat.nlink !== 1) throw new Error(HANDOFF_UNAVAILABLE);
  if (process.platform === "win32") windowsPrivate(directory, file, dirStat, fileStat);
  else {
    posixPrivate(dirStat, true);
    posixPrivate(fileStat, false);
    if (process.platform === "darwin") {
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
    return `postgres://${encodeURIComponent(credentials.user)}:${encodeURIComponent(credentials.password)}@127.0.0.1:${owner.port}/postgres`;
  } finally { closeSync(fd); }
}

function posixPrivate(stat: Stats, directory: boolean): void {
  const required = directory ? 0o700 : 0o600;
  if (stat.uid !== process.getuid!() || (stat.mode & 0o777) !== required) throw new Error(HANDOFF_UNAVAILABLE);
}

const SYSTEM = "S-1-5-18";
const ADMINISTRATORS = "S-1-5-32-544";

const provenPrivate = new Map<string, string>();
const identity = (...stats: Stats[]) => stats.map((s) => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.birthtimeMs}`).join("|");

function windowsPrivate(directory: string, file: string, dirStat: Stats, fileStat: Stats): void {
  const proven = identity(dirStat, fileStat);
  if (provenPrivate.get(directory) === proven) return;
  provenPrivate.delete(directory);
  let user: string;
  let descriptors: Buffer[];
  try {
    user = sidAt(windowsSecurity.user(), 0).sid;
    descriptors = [windowsSecurity.descriptor(directory), windowsSecurity.descriptor(file)];
  } catch (error) {
    if (error instanceof RangeError) throw new HandoffPrivacyError("windows-acl-output");
    throw new HandoffPrivacyError("windows-acl-process");
  }
  for (const descriptor of descriptors) {
    const refusal = descriptorRefusal(descriptor, user);
    if (refusal) throw new HandoffPrivacyError(refusal);
  }
  provenPrivate.set(directory, proven);
}

function sidAt(bytes: Buffer, offset: number): { sid: string; length: number } {
  if (offset < 0 || offset + 8 > bytes.length) throw new RangeError("sid");
  const count = bytes[offset + 1]!;
  if (offset + 8 + 4 * count > bytes.length) throw new RangeError("sid");
  const authority = bytes.readUIntBE(offset + 2, 6);
  const subs = Array.from({ length: count }, (_, i) => bytes.readUInt32LE(offset + 8 + 4 * i));
  return { sid: `S-${bytes[offset]}-${authority}${subs.map((sub) => `-${sub}`).join("")}`, length: 8 + 4 * count };
}

function descriptorRefusal(sd: Buffer, sid: string): WindowsRefusal | undefined {
  if (sd.length < 20) return "windows-acl-output";
  const at = (offset: number, length: number) => {
    if (offset < 0 || offset + length > sd.length) throw new RangeError("descriptor");
    return offset;
  };
  try {
    const control = sd.readUInt16LE(2);
    const ownerOffset = sd.readUInt32LE(4);
    const daclOffset = sd.readUInt32LE(16);
    if (sd[0] !== 1 || !(control & 0x8000)) return "windows-acl-output";
    if (ownerOffset === 0 || sidAt(sd, ownerOffset).sid !== sid) return "windows-acl-owner";
    if (!(control & 0x1000)) return "windows-acl-inheritance";
    if (!(control & 0x0004) || daclOffset === 0) return "windows-acl-exposed";
    const aceCount = sd.readUInt16LE(at(daclOffset, 8) + 4);
    let own = false;
    for (let i = 0, offset = daclOffset + 8; i < aceCount; i += 1) {
      const [type, flags] = [sd[at(offset, 4)]!, sd[offset + 1]!];
      const size = sd.readUInt16LE(offset + 2);
      if (size < 4) return "windows-acl-output";
      at(offset, size);
      if (type === 0) {
        if (size < 16) return "windows-acl-output";
        const trustee = sidAt(sd, offset + 8);
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

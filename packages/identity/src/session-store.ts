import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionStore } from "./client.js";

interface StoreConfiguration { readonly directory: string; readonly clientId: string; readonly identityUrl: string }
const storageError = () => new Error("Private session storage is unavailable. No session was exposed; check its permissions and try again.");
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";

/**
 * POSIX: owner-only directory and file. Windows: CurrentUser DPAPI encryption (never a plaintext fallback).
 * Hold the lock over the whole command, including refresh and sign-out, so competing CLI processes cannot
 * reuse a rotating refresh token or save a session after sign-out. An interrupted command leaves its lock
 * for explicit recovery after checking the recorded PID; we never guess that a slow sign-in has died.
 */
export async function withSessionStore<T>(config: StoreConfiguration, act: (store: SessionStore) => Promise<T>): Promise<T> {
  const directory = path.resolve(config.directory);
  const lock = path.join(directory, "command-lock");
  const file = path.join(directory, "session");
  try { await mkdir(directory, { recursive: true, mode: 0o700 }); await check(directory, true); }
  catch { throw storageError(); }
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`A sign-in command is already running. If it was interrupted, check the PID in ${path.join(lock, "pid")} before removing that command-lock directory.`);
    }
    throw storageError();
  }
  try {
    await writeFile(path.join(lock, "pid"), String(process.pid), { mode: 0o600, flag: "wx" });
    const protect = async <V>(operation: () => Promise<V>): Promise<V> => {
      try { return await operation(); } catch { throw storageError(); }
    };
    return await act({
      read: () => protect(async () => {
        try { await check(file, false); } catch (error) { if (missing(error)) return undefined; throw error; }
        const handle = await open(file, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW));
        let value: string;
        try {
          if ((await handle.stat()).size > 64 * 1024) throw storageError();
          value = await handle.readFile("utf8");
        } finally { await handle.close(); }
        const plain = process.platform === "win32" ? await dpapi(value, false) : value;
        const data = JSON.parse(plain) as Record<string, unknown>;
        if (data.version !== 1 || typeof data.refreshToken !== "string" || !data.refreshToken || data.refreshToken.length > 16_384) throw storageError();
        if (data.clientId !== config.clientId || data.identityUrl !== config.identityUrl) return undefined;
        return data.refreshToken;
      }),
      write: refreshToken => protect(async () => {
        if (!refreshToken || refreshToken.length > 16_384 || /[\x00-\x20\x7f]/.test(refreshToken)) throw storageError();
        const plain = JSON.stringify({ version: 1, clientId: config.clientId, identityUrl: config.identityUrl, refreshToken });
        const value = process.platform === "win32" ? await dpapi(plain, true) : plain;
        const temporary = path.join(directory, `session-${randomUUID()}`);
        try {
          await writeFile(temporary, value, { flag: "wx", mode: 0o600 });
          await rename(temporary, file);
        } finally { await rm(temporary, { force: true }); }
      }),
      clear: () => protect(() => rm(file, { force: true })),
    });
  } finally { await rm(lock, { recursive: true, force: true }); }
}

async function check(file: string, directory: boolean): Promise<void> {
  const info = await lstat(file);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())
    || (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))) throw storageError();
}

/** Secrets travel through stdin/stdout pipes, never command arguments, environment variables or logs. */
function dpapi(value: string, encrypt: boolean): Promise<string> {
  const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Security; `
    + `[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); `
    + `$inputValue = [Console]::In.ReadToEnd(); `
    + (encrypt
      ? `$bytes = [Text.Encoding]::UTF8.GetBytes($inputValue); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)))`
      : `$bytes = [Convert]::FromBase64String($inputValue); [Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)))`);
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"], timeout: 10_000,
    });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 128 * 1024) child.kill();
    });
    child.stderr.resume();
    child.on("error", () => reject(storageError()));
    child.stdin.on("error", () => reject(storageError()));
    child.on("close", code => code === 0 && output ? resolve(output) : reject(storageError()));
    child.stdin.end(value);
  });
}

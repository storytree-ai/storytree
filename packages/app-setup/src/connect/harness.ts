/** The installed harness validates Codex's TOML; no second TOML parser or global CLI edits. */
import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export type Harness = "claude-code" | "codex";
export interface InstalledToolServerCommand {
  readonly command: string;
  readonly args: readonly [string];
}
/** Delivery supplies absolute paths to its bundled Node and existing storytree-mcp.mjs. No cwd or project. */
export function installedToolServerCommand(node: string, server: string): InstalledToolServerCommand {
  if (!path.isAbsolute(node) || !path.isAbsolute(server) || path.basename(server) !== "storytree-mcp.mjs") {
    throw new Error("Use absolute paths to the installed Node and storytree-mcp.mjs.");
  }
  return { command: node, args: [server] };
}

export type RunHarness = (executable: "claude" | "codex", args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<string>;
export const runHarness: RunHarness = (executable, args, options) => new Promise((resolve, reject) => {
  // Every word is fixed by this module. On Windows the installed CLI may be an npm .cmd shim.
  // Installed paths never enter this shell: they are written as JSON/TOML data below.
  const fixed = [executable, ...args];
  if (fixed.some((word) => !/^[a-z-]+$/.test(word))) return reject(new Error("Unexpected harness command"));
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : executable;
  const argv = process.platform === "win32" ? ["/d", "/s", "/c", fixed.join(" ")] : [...args];
  execFile(command, argv, { ...options, timeout: 10_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
    if (error !== null) reject(error);
    else resolve(stdout);
  });
});

export function read(file: string): string | undefined {
  try { return readFileSync(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

/** Refuse a concurrent settings edit; never replace a user's symlink or truncate their file. */
function save(file: string, before: string | undefined, after: string): void {
  if (before === after) return;
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (lstatSync(file).isSymbolicLink()) throw new Error("Settings are a symbolic link; update the target explicitly and retry.");
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (read(file) !== before) throw new Error("Settings changed during registration; retry after the other editor finishes.");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, after, { flag: "wx", mode: existsSync(file) ? statSync(file).mode & 0o777 : 0o600 });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export interface Settings {
  readonly current: unknown;
  compatible(installed: InstalledToolServerCommand): boolean;
  add(installed: InstalledToolServerCommand): Promise<void>;
  remove(): Promise<void>;
  close(): void;
}

export function claudeSettings(file: string): Settings {
  const before = read(file);
  const config: unknown = before === undefined ? {} : JSON.parse(before);
  if (!object(config) || (config.mcpServers !== undefined && !object(config.mcpServers))) throw new Error("Expected a JSON object with an mcpServers object.");
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const current = servers.storytree;
  return {
    current,
    compatible: (installed) => object(current) && (current.type === undefined || current.type === "stdio") &&
      current.command === installed.command && isDeepStrictEqual(current.args ?? [], installed.args) &&
      Object.keys(current).every((key) => ["type", "command", "args", "env"].includes(key)) &&
      (current.env === undefined || isDeepStrictEqual(current.env, {})),
    async add(installed) {
      save(file, before, `${JSON.stringify({ ...config, mcpServers: { ...servers, storytree: { type: "stdio", command: installed.command, args: installed.args, env: {} } } }, null, 2)}\n`);
    },
    async remove() {
      const { storytree: _removed, ...rest } = servers;
      save(file, before, `${JSON.stringify({ ...config, mcpServers: rest }, null, 2)}\n`);
    },
    close() {},
  };
}

export async function codexSettings(file: string, run: RunHarness, env: NodeJS.ProcessEnv): Promise<Settings> {
  const before = read(file);
  const scratch = mkdtempSync(path.join(tmpdir(), "storytree-connect-"));
  const staged = path.join(scratch, "config.toml");
  if (before !== undefined) writeFileSync(staged, before, { mode: 0o600 });
  const cli = (args: readonly string[]) => run("codex", ["mcp", ...args], { cwd: scratch, env: { ...env, CODEX_HOME: scratch } });
  try {
    const listed: unknown = before === undefined ? [] : JSON.parse(await cli(["list", "--json"]));
    if (!Array.isArray(listed) || !listed.every((item) => object(item) && typeof item.name === "string")) throw new Error("Unexpected codex mcp list response; update Codex and retry.");
    const current: unknown = listed.some((item) => item.name === "storytree") ? JSON.parse(await cli(["get", "storytree", "--json"])) : undefined;
    const compatible = (entry: unknown, installed: InstalledToolServerCommand): boolean => {
      if (!object(entry) || entry.enabled !== true || !object(entry.transport)) return false;
      const transport = entry.transport;
      return transport.type === "stdio" && transport.command === installed.command && isDeepStrictEqual(transport.args, installed.args) &&
        (transport.cwd === null || transport.cwd === undefined) &&
        (transport.env == null || isDeepStrictEqual(transport.env, {})) &&
        (transport.env_vars == null || isDeepStrictEqual(transport.env_vars, [])) &&
        (entry.enabled_tools == null) && (entry.disabled_tools == null || isDeepStrictEqual(entry.disabled_tools, []));
    };
    return {
      current,
      compatible: (installed) => compatible(current, installed),
      async add(installed) {
        // JSON's quoted strings/array are also TOML basic strings/array; escape control characters.
        // Appending a fresh table keeps every existing setting and comment byte-for-byte.
        writeFileSync(staged, `${before ?? ""}\n[mcp_servers.storytree]\ncommand = ${JSON.stringify(installed.command)}\nargs = ${JSON.stringify(installed.args)}\n`, { mode: 0o600 });
        if (!compatible(JSON.parse(await cli(["get", "storytree", "--json"])), installed)) throw new Error("Codex did not accept the installed tool server.");
        save(file, before, readFileSync(staged, "utf8"));
      },
      async remove() {
        await cli(["remove", "storytree"]);
        const after: unknown = JSON.parse(await cli(["list", "--json"]));
        if (!Array.isArray(after) || after.some((item) => object(item) && item.name === "storytree")) throw new Error("Codex did not remove the registration; retry.");
        save(file, before, readFileSync(staged, "utf8"));
      },
      close() { rmSync(scratch, { recursive: true, force: true }); },
    };
  } catch (error) { rmSync(scratch, { recursive: true, force: true }); throw error; }
}

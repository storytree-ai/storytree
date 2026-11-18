// Capability 2 · Connect an agent
import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export type { Harness } from "@storytree/project-and-caller/caller";
export interface InstalledToolServerCommand {
  readonly command: string;
  readonly args: readonly [string];
}
export function installedToolServerCommand(node: string, server: string): InstalledToolServerCommand {
  if (!path.isAbsolute(node) || !path.isAbsolute(server) || path.basename(server) !== "storytree-mcp.mjs") {
    throw new Error("Use absolute paths to the installed Node and storytree-mcp.mjs.");
  }
  return { command: node, args: [server] };
}

export function installedCopy(command: unknown, args: unknown): InstalledToolServerCommand | undefined {
  if (typeof command !== "string" || !Array.isArray(args) || args.length !== 1 || typeof args[0] !== "string") return undefined;
  const server: string = args[0];
  if (!path.isAbsolute(command) || !path.isAbsolute(server) || path.basename(server) !== "storytree-mcp.mjs") return undefined;
  if (!/^node(\.exe)?$/i.test(path.basename(command)) || path.dirname(command) !== path.dirname(server)) return undefined;
  return { command, args: [server] };
}

export type RunHarness = (executable: "claude" | "codex" | "cursor-agent" | "pi" | "agy", args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<string>;
export const runHarness: RunHarness = (executable, args, options) => new Promise((resolve, reject) => {
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

export function save(file: string, before: string | undefined, after: string): void {
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
  outdated(installed: InstalledToolServerCommand): boolean;
  anotherCopy(installed: InstalledToolServerCommand): boolean;
  add(installed: InstalledToolServerCommand): Promise<void>;
  update(installed: InstalledToolServerCommand): Promise<void>;
  remove(): Promise<void>;
  close(): void;
}

export function claudeSettings(file: string, own: Readonly<Record<string, unknown>> = {}): Settings {
  const before = read(file);
  const config: unknown = before === undefined ? {} : JSON.parse(before);
  if (!object(config) || (config.mcpServers !== undefined && !object(config.mcpServers))) throw new Error("Expected a JSON object with an mcpServers object.");
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const current = servers.storytree;
  const compatible = (installed: InstalledToolServerCommand): boolean => object(current) && (current.type === undefined || current.type === "stdio") &&
    current.command === installed.command && isDeepStrictEqual(current.args ?? [], installed.args) &&
    Object.keys(current).every((key) => ["type", "command", "args", "env", ...Object.keys(own)].includes(key)) &&
    (current.env === undefined || isDeepStrictEqual(current.env, {}));
  const copy = object(current) ? installedCopy(current.command, current.args) : undefined;
  return {
    current,
    compatible,
    outdated: () => false,
    anotherCopy: (installed) => !compatible(installed) && copy !== undefined && compatible(copy) && installedCopy(installed.command, installed.args) !== undefined,
    async update(installed) {
      save(file, before, `${JSON.stringify({ ...config, mcpServers: { ...servers, storytree: { ...own, ...(current as object), type: "stdio", command: installed.command, args: installed.args, env: {} } } }, null, 2)}\n`);
    },
    async add(installed) {
      save(file, before, `${JSON.stringify({ ...config, mcpServers: { ...servers, storytree: { type: "stdio", command: installed.command, args: installed.args, env: {}, ...own } } }, null, 2)}\n`);
    },
    async remove() {
      const { storytree: _removed, ...rest } = servers;
      save(file, before, `${JSON.stringify({ ...config, mcpServers: rest }, null, 2)}\n`);
    },
    close() {},
  };
}

const CODEX_TOOL_TIMEOUT_SEC = 1800;

export async function codexSettings(file: string, run: RunHarness, env: NodeJS.ProcessEnv, home?: string): Promise<Settings> {
  const before = read(file);
  const scratch = mkdtempSync(path.join(tmpdir(), "storytree-connect-"));
  const staged = path.join(scratch, "config.toml");
  if (before !== undefined) writeFileSync(staged, before, { mode: 0o600 });
  const cli = (args: readonly string[]) => run("codex", ["mcp", ...args], { cwd: scratch, env: { ...env, CODEX_HOME: scratch } });
  try {
    const listed: unknown = before === undefined ? [] : JSON.parse(await cli(["list", "--json"]));
    if (!Array.isArray(listed) || !listed.every((item) => object(item) && typeof item.name === "string")) throw new Error("Unexpected codex mcp list response; update Codex and retry.");
    const current: unknown = listed.some((item) => item.name === "storytree") ? JSON.parse(await cli(["get", "storytree", "--json"])) : undefined;
    const launches = (entry: unknown, installed: InstalledToolServerCommand, hand: string | undefined): boolean => {
      if (!object(entry) || entry.enabled !== true || !object(entry.transport)) return false;
      const transport = entry.transport;
      return transport.type === "stdio" && transport.command === installed.command && isDeepStrictEqual(transport.args, installed.args) &&
        (transport.cwd === null || transport.cwd === undefined) &&
        (hand === undefined ? transport.env == null || isDeepStrictEqual(transport.env, {}) : isDeepStrictEqual(transport.env, { CODEX_HOME: hand })) &&
        (transport.env_vars == null || isDeepStrictEqual(transport.env_vars, [])) &&
        (entry.enabled_tools == null) && (entry.disabled_tools == null || isDeepStrictEqual(entry.disabled_tools, []));
    };
    const compatible = (entry: unknown, installed: InstalledToolServerCommand, hand: string | undefined): boolean =>
      launches(entry, installed, hand) && object(entry) && typeof entry.tool_timeout_sec === "number" && entry.tool_timeout_sec >= CODEX_TOOL_TIMEOUT_SEC;
    const older = (launched: InstalledToolServerCommand) => launches(current, launched, home) || (home !== undefined && launches(current, launched, undefined));
    const append = async (source: string, installed: InstalledToolServerCommand) => {
      writeFileSync(staged, `${source}\n[mcp_servers.storytree]\ncommand = ${JSON.stringify(installed.command)}\nargs = ${JSON.stringify(installed.args)}\n${home === undefined ? "" : `env = { CODEX_HOME = ${JSON.stringify(home)} }\n`}tool_timeout_sec = ${CODEX_TOOL_TIMEOUT_SEC}\n`, { mode: 0o600 });
      if (!compatible(JSON.parse(await cli(["get", "storytree", "--json"])), installed, home)) throw new Error("Codex did not accept the installed tool server.");
      save(file, before, readFileSync(staged, "utf8"));
    };
    return {
      current,
      compatible: (installed) => compatible(current, installed, home),
      outdated: (installed) => !compatible(current, installed, home) && older(installed),
      anotherCopy: (installed) => {
        const transport = object(current) ? current.transport : undefined;
        const copy = object(transport) ? installedCopy(transport.command, transport.args) : undefined;
        return !compatible(current, installed, home) && copy !== undefined && installedCopy(installed.command, installed.args) !== undefined && (compatible(current, copy, home) || older(copy));
      },
      add: (installed) => append(before ?? "", installed),
      async update(installed) {
        await cli(["remove", "storytree"]);
        await append(readFileSync(staged, "utf8"), installed);
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

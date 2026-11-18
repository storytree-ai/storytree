// Capability 2 · Connect an agent
import { mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ANTIGRAVITY_HOOKS, codexHookTrust, PI_EXTENSION } from "@storytree/session-management";
import { HARNESS_IDS, watchedHarness } from "@storytree/project-and-caller/caller";

import { launcherFiles, launcherRuns, removeLauncher } from "../setup/command.js";
import { connectedHarnesses, disconnectedHarnesses, markDisconnected, registerHooks, removeHooks } from "../setup/hooks-config.js";
import { CODEX_TRUST_STEP, installedCodexVersion, runsElevated } from "./codex.js";
import { removeCodexInstructions, writeCodexInstructions } from "./codex-agents.js";
import { claudeSettings, codexSettings, installedToolServerCommand, read, runHarness, type Harness, type InstalledToolServerCommand, type RunHarness, type Settings } from "./harness.js";

export { installedToolServerCommand };
export type { Harness, InstalledToolServerCommand, RunHarness };
export interface ConnectionOptions {
  readonly harnesses: readonly Harness[];
  readonly installed: InstalledToolServerCommand;
  readonly home?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly run?: RunHarness;
  readonly elevated?: () => Promise<boolean>;
}
export interface ConnectionResult {
  readonly harness: Harness;
  readonly settingsFile: string;
  readonly tools: "connected" | "already connected" | "not connected";
  readonly hooks: "not verified" | "waiting for you to trust them in Codex" | "running";
  readonly next: string;
  readonly where?: string;
}
export interface DisconnectionResult {
  readonly harness: Harness;
  readonly tools: "disconnected" | "not connected" | "kept";
  readonly next: string;
}
export interface DisconnectReport {
  readonly harnesses: readonly DisconnectionResult[];
  readonly command: "removed" | "none" | "kept";
  readonly next: string;
}

function locations(options: ConnectionOptions) {
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;
  const claude = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const codex = env.CODEX_HOME || path.join(home, ".codex");
  const storytree = env.STORYTREE_HOME || path.join(home, ".storytree", "0.3");
  const cursor = path.join(home, ".cursor");
  const pi = env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent");
  const antigravity = path.join(home, ".gemini");
  return { home, env, claude, codex, cursor, pi, antigravity, storytree, files: {
    "claude-code": env.CLAUDE_CONFIG_DIR ? path.join(claude, ".claude.json") : path.join(home, ".claude.json"),
    codex: path.join(codex, "config.toml"),
    cursor: path.join(cursor, "mcp.json"),
    pi: path.join(pi, "mcp.json"),
    antigravity: path.join(antigravity, "config", "mcp_config.json"),
  } };
}
const hookCommand = (installed: InstalledToolServerCommand) => ({ node: installed.command, script: path.join(path.dirname(installed.args[0]), "storytree-hook.mjs") });
const executable = (harness: Harness) => harness === "claude-code" ? "claude" : harness === "codex" ? "codex" : harness === "pi" ? "pi" : harness === "antigravity" ? "agy" : "cursor-agent";
export const agentLabel = (harness: Harness) => watchedHarness(harness)?.label ?? harness;
const label = agentLabel;
const hooksFileOf = (where: ReturnType<typeof locations>, harness: Harness) => harness === "claude-code" ? path.join(where.claude, "settings.json") : harness === "pi" ? path.join(where.pi, PI_EXTENSION) : harness === "antigravity" ? path.join(where.antigravity, ANTIGRAVITY_HOOKS) : path.join(where[harness], "hooks.json");
const harnessHomeOf = (where: ReturnType<typeof locations>, harness: Harness) => harness === "pi" ? where.pi : harness === "antigravity" ? where.antigravity : path.dirname(hooksFileOf(where, harness));
const homesOf = (where: ReturnType<typeof locations>) => ({ claude: where.claude, codex: where.codex, cursor: where.cursor, pi: where.pi, antigravity: where.antigravity });
const PI_ENTRY = { exposure: "direct", description: "storytree: the project's plan, claims, library and questions" };
async function openSettings(harness: Harness, options: ConnectionOptions): Promise<Settings> {
  const where = locations(options);
  return harness !== "codex" ? claudeSettings(where.files[harness], harness === "pi" ? PI_ENTRY : {}) : codexSettings(where.files[harness], options.run ?? runHarness, where.env, where.codex === path.join(where.home, ".codex") ? undefined : where.codex);
}
const ELEVATED = "This terminal runs as administrator, and Codex cannot run commands when started from one (its Windows sandbox times out on each): open Codex from a normal terminal, not \"Run as administrator\".";
const conflict = (file: string) => `The existing storytree entry in ${file} is incompatible and was kept (including any 0.2 entry). Review or move that entry yourself before retrying. The name storytree is required by the existing hooks.`;

export async function connectAgents(options: ConnectionOptions): Promise<ConnectionResult[]> {
  const where = locations(options);
  const results: ConnectionResult[] = [];
  const elevated = options.harnesses.includes("codex") && await (options.elevated ?? runsElevated)().catch(() => false);
  const hook = hookCommand(options.installed);
  for (const harness of new Set(options.harnesses)) {
    const settingsFile = where.files[harness];
    const result = (tools: ConnectionResult["tools"], next: string, hooks: ConnectionResult["hooks"] = "not verified", where?: string) =>
      results.push({ harness, settingsFile, tools, hooks, next: harness === "codex" && elevated ? `${next} ${ELEVATED}` : next, ...(where === undefined ? {} : { where }) });
    try {
      const installed = installedToolServerCommand(options.installed.command, options.installed.args[0]);
      if (options.installed.args.length !== 1 || ![installed.command, installed.args[0]].every((file) => statSync(file).isFile())) throw new Error("Missing installed tools");
    } catch {
      result("not connected", "Re-run the storytree installer to restore its bundled Node and tool server, then retry Connect.");
      continue;
    }
    try {
      await (options.run ?? runHarness)(executable(harness), ["--version"], { cwd: where.home, env: where.env });
    } catch {
      result("not connected", `Install ${label(harness)}, sign in, and check that ${executable(harness)} --version works in a fresh terminal; reopen storytree and retry Connect.`);
      continue;
    }
    let settings: Settings | undefined;
    const hooksFile = hooksFileOf(where, harness);
    const harnessHome = harnessHomeOf(where, harness);
    let checkingFile = hooksFile;
    try {
      mkdirSync(harnessHome, { recursive: true });
      const hooksText = harness === "pi" ? undefined : read(checkingFile);
      if (hooksText !== undefined) {
        const hooks: unknown = JSON.parse(hooksText);
        if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) throw new Error("Expected a settings object");
      }
      checkingFile = settingsFile;
      settings = await openSettings(harness, options);
      const outdated = settings.current !== undefined && (settings.outdated(options.installed) || settings.anotherCopy(options.installed));
      if (settings.current !== undefined && !outdated && !settings.compatible(options.installed)) {
        result("not connected", conflict(settingsFile));
        continue;
      }
      const tools = settings.current === undefined || outdated ? "connected" : "already connected";
      if (outdated) await settings.update(options.installed);
      else if (settings.current === undefined) await settings.add(options.installed);
      markDisconnected(where.storytree, harness, false);
      checkingFile = hooksFile;
      const codexVersion = harness === "codex" ? installedCodexVersion({ codexHome: where.codex, ...(where.env.PATH === undefined ? {} : { path: where.env.PATH }) }) : undefined;
      const registration = registerHooks(harness === "claude-code" ? { claude: where.claude } : { [harness]: harnessHome }, hook, undefined, codexVersion)[harness];
      if (registration !== "registered" && registration !== "already registered") throw new Error(`Hooks ${registration}`);
      if (harness === "codex" || harness === "pi") writeCodexInstructions(harnessHome);
      const trust = harness === "codex" ? codexHookTrust({ storytreeHome: where.storytree, codexHome: where.codex }) : "not registered";
      if (trust === "running") result(tools, "Tools connected in user settings; Codex has run storytree's hooks. Start a new Codex session in the folder of your project.", "running");
      else if (trust === "waiting") result(tools, `Tools connected in user settings. One step is yours: Codex runs storytree's hooks only once you have trusted them, and until then storytree cannot see Codex's work. ${CODEX_TRUST_STEP}`, "waiting for you to trust them in Codex");
      else if (harness === "cursor") result(tools, "Tools connected in user settings; hooks not verified. Start a new Cursor agent session in the folder of your project and call check_setup.");
      else if (harness === "antigravity") result(tools, "Tools connected in user settings and storytree's hooks added to Antigravity's hooks.json; hooks not verified. Start a new agy session in the folder of your project and call check_setup.");
      else if (harness === "pi") result(tools, "Tools connected in user settings and storytree's Pi extension installed; hooks not verified. Start a new Pi session in the folder of your project and call check_setup.");
      else result(tools, "Not yet verified: that happens the first time you start Claude Code in your project's folder and approve its check. If storytree does not hear from it, ask the agent to run check_setup; it names each missing hook until its event is received.",
        "not verified", "Written to Claude Code's user settings; project or managed settings can override it.");
    } catch {
      const reason = harness === "codex" ? " Check that codex mcp list --json succeeds and hooks.json contains a valid JSON object." : " Check that the file contains a valid JSON object.";
      result("not connected", `Repair ${checkingFile} or its write permissions, then retry Connect.${reason}`);
    } finally { settings?.close(); }
  }
  return results;
}

export async function reconnectAgents(options: Omit<ConnectionOptions, "harnesses">): Promise<ConnectionResult[]> {
  const where = locations({ ...options, harnesses: [] });
  const disconnected = disconnectedHarnesses(where.storytree);
  const harnesses = [...connectedHarnesses(homesOf(where))].filter((harness) => !disconnected.has(harness));
  return harnesses.length === 0 ? [] : connectAgents({ ...options, harnesses });
}

export function agentFiles(options: Pick<ConnectionOptions, "home" | "env">): string[] {
  const where = locations({ ...options, harnesses: [], installed: { command: "", args: [""] } });
  return HARNESS_IDS.flatMap((harness) => [where.files[harness], hooksFileOf(where, harness)]);
}

export interface FoundAgent {
  readonly harness: Harness;
  readonly agent: string;
  readonly connected: boolean;
  readonly note?: string;
}

export const PROBE_TIMEOUT_MS = 15_000;

export async function agentsOnThisComputer(options: Omit<ConnectionOptions, "harnesses"> & { readonly probeTimeoutMs?: number }): Promise<FoundAgent[]> {
  const where = locations({ ...options, harnesses: [] });
  const bound = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  const seconds = `${bound / 1000} second${bound === 1000 ? "" : "s"}`;
  const ask = async (harness: Harness): Promise<FoundAgent | undefined> => {
    let answered = false;
    const probe = (async () => {
      try { await (options.run ?? runHarness)(executable(harness), ["--version"], { cwd: where.home, env: where.env }); } catch { return undefined; }
      answered = true;
      let settings: Settings | undefined;
      let connected = false;
      try {
        settings = await openSettings(harness, { ...options, harnesses: [harness] });
        connected = settings.current !== undefined && settings.compatible(options.installed);
      } catch {} finally { settings?.close(); }
      return { harness, agent: label(harness), connected };
    })();
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<FoundAgent>((resolve) => {
      timer = setTimeout(() => resolve({ harness, agent: label(harness), connected: false, note: answered
        ? `${label(harness)} answered, but its settings were not read within ${seconds}, so whether it is connected is not known. Connect it to check.`
        : `${label(harness)} did not answer ${executable(harness)} --version within ${seconds}, so it is offered without being confirmed. If it is installed, Connect it; if not, Connect says how to install it.` }), bound);
    });
    try { return await Promise.race([probe, late]); } finally { clearTimeout(timer); }
  };
  const found = await Promise.all(HARNESS_IDS.map(ask));
  return found.filter((each): each is FoundAgent => each !== undefined);
}

export async function disconnectAgents(options: ConnectionOptions): Promise<DisconnectReport> {
  const where = locations(options);
  const harnesses: DisconnectionResult[] = [];
  const hook = hookCommand(options.installed);
  for (const harness of new Set(options.harnesses)) {
    let settings: Settings | undefined;
    try {
      settings = await openSettings(harness, options);
      if (settings.current !== undefined && !settings.compatible(options.installed) && !settings.outdated(options.installed)) {
        harnesses.push({ harness, tools: "kept", next: conflict(where.files[harness]) });
        continue;
      }
      removeHooks(homesOf(where), { harness, hook });
      if (harness === "codex" || harness === "pi") removeCodexInstructions(harnessHomeOf(where, harness));
      if (settings.current !== undefined) await settings.remove();
      markDisconnected(where.storytree, harness, true);
      harnesses.push({ harness, tools: settings.current === undefined ? "not connected" : "disconnected", next: "Restart this agent to finish disconnecting. Project libraries and unrelated settings were kept." });
    } catch {
      harnesses.push({ harness, tools: "kept", next: `Repair ${where.files[harness]} and ${hooksFileOf(where, harness)}; for Codex, check codex mcp list --json. Retry Disconnect to finish cleanup.` });
    } finally { settings?.close(); }
  }
  let command: DisconnectReport["command"] = "kept";
  if (harnesses.length > 0 && harnesses.every((result) => result.tools !== "kept")) {
    let remaining = false;
    for (const harness of HARNESS_IDS) {
      let settings: Settings | undefined;
      try {
        settings = await openSettings(harness, options);
        remaining ||= settings.current !== undefined;
      } catch { remaining = true; }
      finally { settings?.close(); }
    }
    if (!remaining) {
      try {
        for (const harness of HARNESS_IDS) removeHooks(homesOf(where), { harness, hook });
        removeCodexInstructions(where.codex);
        removeCodexInstructions(where.pi);
        command = removeInstalledCommand(where.home, where.env, options.installed);
      } catch { command = "kept"; }
    }
  }
  return { harnesses, command, next: command === "kept" ? "Shared command kept while another connection exists or cleanup cannot be confirmed; retry Disconnect for cleanup when no connection remains." : "All user connections removed. Project libraries and unrelated settings were kept." };
}

export interface RemovalResult {
  readonly harness: Harness;
  readonly tools: "removed" | "none" | "kept";
  readonly next?: string;
}

function commandOf(current: unknown): unknown {
  if (current === null || typeof current !== "object") return undefined;
  const entry = current as { transport?: { command?: unknown }; command?: unknown };
  return entry.transport !== null && typeof entry.transport === "object" ? entry.transport.command : entry.command;
}

function inside(file: unknown, folder: string): boolean {
  if (typeof file !== "string" || !path.isAbsolute(file)) return false;
  const relative = path.relative(path.resolve(folder).toLowerCase(), path.resolve(file).toLowerCase());
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export async function removeConnections(options: Omit<ConnectionOptions, "harnesses"> & { readonly installDir?: string; readonly also?: readonly InstalledToolServerCommand[] }): Promise<RemovalResult[]> {
  const where = locations({ ...options, harnesses: [] });
  const installed = [options.installed, ...(options.also ?? [])];
  const results: RemovalResult[] = [];
  for (const harness of HARNESS_IDS) {
    let settings: Settings | undefined;
    try {
      for (const each of installed) removeHooks(homesOf(where), { harness, hook: hookCommand(each) });
      if (harness === "codex" || harness === "pi") removeCodexInstructions(harnessHomeOf(where, harness));
      if (harness === "codex" && !/mcp_servers\.["']?storytree\b/.test(read(where.files.codex) ?? "")) { results.push({ harness, tools: "none" }); continue; }
      settings = await openSettings(harness, { ...options, harnesses: [] });
      const ours = settings.current !== undefined && (installed.some((each) => settings!.compatible(each) || settings!.outdated(each)) ||
        (options.installDir !== undefined && inside(commandOf(settings.current), options.installDir)));
      if (ours) await settings.remove();
      results.push({ harness, tools: ours ? "removed" : "none" });
    } catch {
      const next = harness === "claude-code"
        ? `remove the storytree entry under mcpServers in ${where.files[harness]}, and storytree's hooks and status line in ${path.join(where.claude, "settings.json")}.`
        : harness === "cursor" || harness === "pi" || harness === "antigravity"
          ? `remove the storytree entry under mcpServers in ${where.files[harness]}, and storytree's hooks in ${hooksFileOf(where, harness)}.`
          : `run codex mcp remove storytree, or delete the [mcp_servers.storytree] table in ${where.files[harness]}; storytree's hooks are in ${path.join(where.codex, "hooks.json")}.`;
      results.push({ harness, tools: "kept", next: `storytree could not remove its connection; ${next}` });
    } finally { settings?.close(); }
  }
  return results;
}

function removeInstalledCommand(home: string, env: NodeJS.ProcessEnv, installed: InstalledToolServerCommand): "removed" | "none" {
  const target = path.join(path.dirname(installed.args[0]), "storytree.mjs");
  let removed = false;
  for (const folder of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    const relative = path.relative(home, folder);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    for (const name of launcherFiles()) {
      const file = path.join(folder, name);
      const runs = launcherRuns(file);
      if (runs?.node === installed.command && runs.target === target) { removeLauncher(file); removed = true; }
    }
  }
  return removed ? "removed" : "none";
}

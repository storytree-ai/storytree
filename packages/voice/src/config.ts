/**
 * Capability 1 · The address and its guards: the door's settings (contract 1.11) and what its children inherit
 * (contracts 1.12, 1.13). The same settings as the spike it replaces, so its env file carries over (ADR-1132 D4).
 */
import net from "node:net";
import path from "node:path";
import { realpathSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { localhostAllowedHostnames } from "@modelcontextprotocol/server";
import { SESSION_ENV, WATCHED_HARNESSES, type WatchedHarness } from "@storytree/project-and-caller/caller";

export interface VoiceConfig {
  readonly token: string;
  /** The door's own repository copy, resolved: children run here and code is read from its HEAD. */
  readonly repoDir: string;
  readonly port: number;
  /** The storytree command line as an argument array; STORYTREE_CLI replaces it in tests. */
  readonly cli: readonly string[];
  readonly allowedHosts: readonly string[];
  /** Caller ranges the X-Forwarded-For first hop must fall in, or null when none are configured. */
  readonly cidrs: net.BlockList | null;
  readonly cidrText: string;
  /** The environment every child starts from, before its voice session id is added. */
  readonly childEnv: Readonly<Record<string, string>>;
}

/** A setting the door cannot start with; its message names what to fix and never holds the secret. */
export class ConfigError extends Error {}

/** The door's own settings and its secret: none of them reaches a child. */
const DOOR_SETTINGS = ["VOICE_TOKEN", "VOICE_SPIKE_TOKEN", "PORT", "REPO_DIR", "ALLOWED_HOSTS", "ALLOWED_CIDRS", "STORYTREE_CLI"];

/** Every harness's session variable, and storytree's own: a child names the voice session and no other (1.13). */
const SESSION_NAMES = [SESSION_ENV, ...(WATCHED_HARNESSES as readonly WatchedHarness[]).flatMap((harness) => (harness.shellSession ? [harness.shellSession] : []))];

const SCRUBBED = new Set([...DOOR_SETTINGS, ...SESSION_NAMES].map((name) => name.toUpperCase()));

export function loadConfig(env: NodeJS.ProcessEnv): VoiceConfig {
  // VOICE_TOKEN, or the spike's VOICE_SPIKE_TOKEN, so the spike's env file and the owner's connector keep working.
  const token = env.VOICE_TOKEN || env.VOICE_SPIKE_TOKEN || "";
  if (token.length < 32) throw new ConfigError("VOICE_TOKEN is missing or shorter than 32 characters; generate one with: openssl rand -hex 32");
  if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new ConfigError("VOICE_TOKEN may hold only letters, digits, '-' and '_' (it sits in a URL path)");

  if (!env.REPO_DIR) throw new ConfigError("REPO_DIR is required: the door's own copy of the storytree repository");
  let repoDir: string;
  try {
    repoDir = realpathSync(path.resolve(env.REPO_DIR));
    if (!statSync(repoDir).isDirectory()) throw new Error("not a folder");
  } catch {
    throw new ConfigError("REPO_DIR is not a readable folder");
  }

  const port = env.PORT === undefined || env.PORT === "" ? 8787 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError("PORT must be a whole number from 0 to 65535");

  let cli: string[];
  if (env.STORYTREE_CLI) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.STORYTREE_CLI);
    } catch {
      throw new ConfigError("STORYTREE_CLI must be a JSON array of strings");
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((part) => typeof part === "string" && part !== "")) {
      throw new ConfigError("STORYTREE_CLI must be a non-empty JSON array of non-empty strings");
    }
    cli = parsed as string[];
  } else {
    // The command line run directly, as the MCP server's way in does: pnpm's script shell would expand "$" in a caller's words.
    cli = [
      process.execPath,
      "--import",
      pathToFileURL(path.join(repoDir, "node_modules", "tsx", "dist", "loader.mjs")).href,
      path.join(repoDir, "packages", "cli", "src", "bins", "storytree.ts"),
    ];
  }

  const allowedHosts = [...localhostAllowedHostnames(), ...list(env.ALLOWED_HOSTS).map((host) => host.toLowerCase())];

  let cidrs: net.BlockList | null = null;
  const cidrList = list(env.ALLOWED_CIDRS);
  if (cidrList.length > 0) {
    cidrs = new net.BlockList();
    for (const cidr of cidrList) {
      const [address = "", bits, extra] = cidr.split("/");
      const family = net.isIP(address);
      const prefix = Number(bits);
      if (bits === undefined || extra !== undefined || family === 0 || !Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) {
        throw new ConfigError(`ALLOWED_CIDRS holds "${cidr}", which is not a CIDR such as 160.79.104.0/21`);
      }
      cidrs.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
    }
  }

  return { token, repoDir, port, cli, allowedHosts, cidrs, cidrText: cidrList.join(","), childEnv: inheritable(env) };
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((part) => part.trim()).filter((part) => part !== "");
}

/** The door's environment less its secret, its settings, every session id and pnpm's variables. */
function inheritable(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const upper = name.toUpperCase();
    if (value === undefined || SCRUBBED.has(upper) || upper.startsWith("NPM_") || upper.startsWith("PNPM_")) continue;
    out[name] = value;
  }
  return out;
}

/** The voice session a child records under on a given day: voice-YYYY-MM-DD, in UTC. */
export function voiceSession(now: Date): string {
  return `voice-${now.toISOString().slice(0, 10)}`;
}

/** A child's environment: the inheritable one, with the day's voice session id. */
export function childEnvFor(config: VoiceConfig, now: Date = new Date()): Record<string, string> {
  return { ...config.childEnv, [SESSION_ENV]: voiceSession(now) };
}

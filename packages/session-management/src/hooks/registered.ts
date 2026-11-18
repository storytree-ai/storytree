// Capability 3 · Hooks
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface Homes {
  readonly claude?: string;
  readonly codex?: string;
  readonly cursor?: string;
  readonly pi?: string;
  readonly antigravity?: string;
}

export function defaultHomes(env: Readonly<Record<string, string | undefined>> = process.env): Required<Homes> {
  return {
    claude: env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"),
    codex: env.CODEX_HOME || path.join(homedir(), ".codex"),
    cursor: path.join(homedir(), ".cursor"),
    pi: env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent"),
    antigravity: path.join(homedir(), ".gemini"),
  };
}

export const ANTIGRAVITY_HOOKS = path.join("config", "hooks.json");

export const PI_EXTENSION = path.join("extensions", "storytree.ts");
export const PI_EXTENSION_SCRIPT = "const SCRIPT = ";

export function piExtensionScript(text: string): string | undefined {
  const line = text.split("\n").find((one) => one.startsWith(PI_EXTENSION_SCRIPT));
  try {
    const script: unknown = line === undefined ? undefined : JSON.parse(line.slice(PI_EXTENSION_SCRIPT.length).replace(/;\s*$/, ""));
    return typeof script === "string" ? script : undefined;
  } catch {
    return undefined;
  }
}

export function registeredHookScripts(homes: Homes = defaultHomes()): string[] {
  const scripts: string[] = [];
  if (homes.pi !== undefined) {
    try {
      const script = piExtensionScript(readFileSync(path.join(homes.pi, PI_EXTENSION), "utf8"));
      if (script !== undefined) scripts.push(script);
    } catch {
    }
  }
  for (const file of [homes.claude && path.join(homes.claude, "settings.json"), homes.codex && path.join(homes.codex, "hooks.json"), homes.cursor && path.join(homes.cursor, "hooks.json"), homes.antigravity && path.join(homes.antigravity, ANTIGRAVITY_HOOKS)]) {
    if (file === undefined) continue;
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (value !== null && typeof value === "object") for (const inner of Object.values(value)) collect(inner);
    };
    try {
      collect(JSON.parse(readFileSync(file, "utf8")));
    } catch {
      continue;
    }
    scripts.push(...scriptsIn(strings));
  }
  return scripts;
}

export function scriptsIn(strings: readonly unknown[]): string[] {
  return strings.flatMap((text) => typeof text !== "string" ? [] : text.split(/['"]/).flatMap(scriptsInPart));
}

const HOOK_FILE = "storytree-hook.mjs";

function scriptsInPart(part: string): string[] {
  const found: string[] = [];
  for (let start = 0; start < part.length; start++) {
    if (start > 0 && !/\s/.test(part[start - 1]!)) continue;
    const slash = /[A-Za-z]/.test(part[start]!) && part[start + 1] === ":" ? start + 2 : start;
    if (part[slash] !== "/" && part[slash] !== "\\") continue;
    const end = part.indexOf(HOOK_FILE, slash + 1);
    if (end < 0) break;
    found.push(part.slice(start, end + HOOK_FILE.length));
    start = end + HOOK_FILE.length;
  }
  return found;
}

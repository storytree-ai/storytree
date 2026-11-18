// Capability 3 · Hooks
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const NOTE = "codex-hooks-ran";

export type CodexHookTrust = "running" | "waiting" | "not registered";

export interface CodexHomes {
  readonly storytreeHome: string;
  readonly codexHome: string;
}

export function noteCodexHookRan({ storytreeHome, codexHome }: CodexHomes): void {
  try {
    if (codexHookTrust({ storytreeHome, codexHome }) !== "waiting") return;
    mkdirSync(storytreeHome, { recursive: true });
    writeFileSync(path.join(storytreeHome, NOTE), `${new Date().toISOString()}\n`);
  } catch {
  }
}

export function codexHookTrust({ storytreeHome, codexHome }: CodexHomes): CodexHookTrust {
  const hooks = path.join(codexHome, "hooks.json");
  const registered = modified(hooks);
  if (registered === undefined || !holdsStorytrees(hooks)) return "not registered";
  const ran = modified(path.join(storytreeHome, NOTE));
  return ran !== undefined && ran >= registered ? "running" : "waiting";
}

function holdsStorytrees(file: string): boolean {
  try {
    return readFileSync(file, "utf8").includes("storytree-hook.mjs");
  } catch {
    return false;
  }
}

function modified(file: string): number | undefined {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}

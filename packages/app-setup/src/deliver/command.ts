import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { InstalledTools } from "./payload.js";

// Share recognition with agent-link's existing command setup; its meaning is unchanged.
const marker = "storytree 0.3's command (put here by its setup check)";
export interface CommandResult {
  status: "installed" | "already installed" | "conflict";
  file: string;
  pathEntry: string;
  conflict?: string;
  /** storytree launchers elsewhere on PATH that pointed at another build and now run this one. */
  replaced?: string[];
}

export function installCommand(options: { home: string; tools: InstalledTools; searchPath: string; platform?: NodeJS.Platform; pathExt?: string }): CommandResult {
  const windows = (options.platform ?? process.platform) === "win32";
  const pathEntry = path.join(options.home, "bin");
  const file = path.join(pathEntry, windows ? "storytree.cmd" : "storytree");
  const folders = [...new Set([...options.searchPath.split(windows ? ";" : ":").filter(Boolean).map((dir) => dir.replace(/^"|"$/g, "")), pathEntry])];
  const ours: string[] = [];
  const extensions = new Set(["", ".ps1", ".exe", ".com", ".bat", ".cmd", ...(options.pathExt ?? process.env.PATHEXT ?? ".VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC").toLowerCase().split(";")]);
  for (const folder of folders) {
    if (!existsSync(folder) || !statSync(folder).isDirectory()) continue;
    for (const name of readdirSync(folder)) {
      const lower = name.toLowerCase();
      if (windows ? !lower.startsWith("storytree") || !extensions.has(lower.slice("storytree".length)) : name !== "storytree") continue;
      const candidate = path.join(folder, name);
      let owned = false;
      try { owned = readFileSync(candidate, "utf8").includes(marker); } catch { /* An unreadable command is not ours. */ }
      if (!owned) return { status: "conflict", file, pathEntry, conflict: candidate };
      ours.push(candidate);
    }
  }
  const quote = windows
    ? (value: string) => `"${value.replaceAll("%", "%%")}"`
    : (value: string) => `"${value.replace(/[\\$`]/g, "\\$&")}"`;
  if ([options.tools.node, options.tools.cli].some((value) => /[\r\n"]/.test(value))) throw new Error("Command paths contain an unsupported quote or newline");
  const command = windows
    ? `@echo off\r\nrem ${marker}\r\ngoto #_storytree_handoff_# 2>nul || ${quote(options.tools.node)} ${quote(options.tools.cli)} %*\r\n`
    : `#!/bin/sh\n# ${marker}\nexec ${quote(options.tools.node)} ${quote(options.tools.cli)} "$@"\n`;
  const targets = [...new Set([...ours, file])];
  const same = targets.every((target) => existsSync(target) && readFileSync(target, "utf8") === command);
  const replaced: string[] = [];
  mkdirSync(pathEntry, { recursive: true });
  for (const target of targets) {
    if (existsSync(target) && readFileSync(target, "utf8") === command) continue;
    // Our own launchers earlier on PATH would shadow this one, so they are repointed, and said so.
    if (target !== file) replaced.push(target);
    writeFileSync(target, command);
    if (!windows) chmodSync(target, 0o755);
  }
  return { status: same ? "already installed" : "installed", file, pathEntry, replaced };
}

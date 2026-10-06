/** Capability 1 · Get storytree. */
import { launcherFile, launcherFor, removeLauncher, writeLauncher } from "@storytree/agent-link";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { InstalledTools } from "./payload.js";

// The agent link's launcher, recognised by its marker line: on Windows a program of its own (ADR-0854).
const marker = "storytree 0.3's command (put here by its setup check)";
export interface CommandResult {
  status: "installed" | "already installed" | "conflict";
  file: string;
  pathEntry: string;
  conflict?: string;
  /** storytree launchers elsewhere on PATH that pointed at another build, or were its batch file, and now run this one. */
  replaced?: string[];
}

export function installCommand(options: { home: string; tools: InstalledTools; searchPath: string; platform?: NodeJS.Platform; pathExt?: string }): CommandResult {
  const platform = options.platform ?? process.platform;
  const windows = platform === "win32";
  const pathEntry = path.join(options.home, "bin");
  const file = path.join(pathEntry, launcherFile(platform));
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
  const command = launcherFor(options.tools.node, options.tools.cli, platform);
  const replaced: string[] = [];
  let changed = false;
  mkdirSync(pathEntry, { recursive: true });
  for (const found of [...new Set([...ours, file])]) {
    // Each launcher of ours becomes this one in its own folder: the batch file storytree wrote before ADR-0854 included.
    const target = path.join(path.dirname(found), path.basename(file));
    if (found === target && existsSync(target) && readFileSync(target).equals(command)) continue;
    writeLauncher(target, command);
    if (found !== target) removeLauncher(found);
    changed = true;
    // Our own launchers earlier on PATH would shadow this one, so they are repointed, and said so.
    if (found !== file) replaced.push(found);
  }
  return { status: changed ? "installed" : "already installed", file, pathEntry, replaced };
}

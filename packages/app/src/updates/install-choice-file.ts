// Capability 4 · Updates
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseInstallChoice, type InstallChoice, type InstallChoiceState } from "./install-choice.js";

const QUIET: InstallChoice = { mode: "quiet" };

export function installChoice(options: { available: boolean; file: string }) {
  const read = (): InstallChoiceState => {
    let choice = QUIET;
    try { choice = parseInstallChoice(JSON.parse(readFileSync(options.file, "utf8"))); }
    catch { }
    return { available: options.available, choice };
  };
  return {
    read,
    set(value: unknown): InstallChoiceState {
      if (!options.available) throw new Error("Only the installed app installs updates itself.");
      const choice = parseInstallChoice(value);
      mkdirSync(path.dirname(options.file), { recursive: true });
      writeFileSync(options.file, `${JSON.stringify(choice)}\n`);
      return read();
    },
  };
}

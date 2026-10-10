// What the installed command answers, on Windows, for the same word from Windows PowerShell 5.1 and from Git Bash
// (contract 1.12, ADR-0856). Run from this checkout on Windows: node --import tsx packages/cli/evidence/powershell-quoting/answers.ts
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { launcherFor } from "@storytree/app-setup/setup";
import { buildCommand } from "../../src/bins/build.js";

const dir = mkdtempSync(path.join(tmpdir(), "storytree answers "));
try {
  const built = await buildCommand(path.join(dir, "built"));
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "storytree.exe"), launcherFor(process.execPath, built));
  const env = { ...process.env, PATH: bin, Path: bin, STORYTREE_HOME: path.join(dir, "storytree home") };
  const word = 'he said "website -> forest" ok';
  const script = `& storytree '${word.replaceAll("'", "''")}'`;
  const powershell = spawnSync("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { cwd: dir, env, encoding: "utf8" });
  console.log(`From Windows PowerShell 5.1: storytree '${word}'\nexit ${powershell.status}\n${powershell.stderr}`);
  const bash = spawnSync("C:\\Program Files\\Git\\bin\\bash.exe", ["-c", `storytree '${word}'`], { cwd: dir, env, encoding: "utf8" });
  console.log(`From Git Bash: storytree '${word}'\nexit ${bash.status}\n${bash.stderr}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

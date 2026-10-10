/**
 * Capability 1 · Front door, contract 1.12: the words the installed command is handed on Windows, where its
 * launcher is a program of its own that passes the caller's line on unchanged (ADR-0854). Windows PowerShell 5.1
 * hands a word holding a space and a double quote on with its inner quotes unescaped, so the command reads other
 * words than the ones written: the door refuses them before acting. The command runs as a user's does: the agent
 * link's launcher, on the path, in front of the built command.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { launcherFor } from "@storytree/app-setup/setup";
import { BuiltCommand } from "./testing/cli.js";

const windows = process.platform === "win32";
const command = new BuiltCommand();
before(async () => { if (windows) await command.build(); });
after(() => command.remove());

test("1.12 on Windows, a word whose double quotes the caller's own quoting changed, as Windows PowerShell 5.1 hands on a word holding a space and a double quote, is refused before the command acts, naming it and saying to pass it from a file; the same word from Git Bash reaches the command", {
  skip: !windows && "platform:win32: only on Windows does the installed command's launcher hand the caller's line on, and only Windows PowerShell 5.1 leaves a word's inner quotes unescaped",
}, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree launched "));
  try {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "storytree.exe"), launcherFor(process.execPath, command.script));
    const env = { ...process.env, PATH: bin, Path: bin, STORYTREE_HOME: path.join(dir, "storytree home") };
    const word = 'he said "website -> forest" ok';

    const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const script = `& storytree '${word.replaceAll("'", "''")}'`;
    const refused = spawnSync(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { cwd: dir, env, encoding: "utf8", timeout: 60_000 });
    assert.equal(refused.status, 1, `${refused.stdout}${refused.stderr}`);
    assert.match(refused.stderr, /word 1/);
    assert.match(refused.stderr, /@<file>/);
    assert.doesNotMatch(refused.stderr, /has no/, "the command acted on the changed words");

    const bash = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
    const reached = spawnSync(bash, ["-c", `storytree '${word}'`], { cwd: dir, env, encoding: "utf8", timeout: 60_000 });
    assert.match(reached.stderr, /has no/, `the word, quoted by Windows' standard rules, reached the command: ${reached.stdout}${reached.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

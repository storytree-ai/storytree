/**
 * Capability 8 · Setup check: contract 8.35, on Windows a storytree command run in a project folder runs git from the
 * path, never a git.exe planted in that folder.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { buildBins } from "./build.js";

test("8.35 on Windows, the hook command run in a project folder holding a planted git.exe runs git from the path, never the planted one, even when its caller did not set NoDefaultCurrentDirectoryInExePath", { skip: process.platform !== "win32" && "platform:win32: Windows alone searches the working folder for a bare program name", timeout: 240_000 }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-path-only-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { "storytree-hook": hook } = await buildBins(path.join(dir, "bin"), { launcher: false });

  // A project folder whose .git holds no HEAD, so the hook asks `git symbolic-ref` for its branch. The planted git.exe is
  // Node, which runs the file `symbolic-ref` beside it: that file leaving a mark is the planted program having run.
  const project = path.join(dir, "project");
  mkdirSync(path.join(project, ".git"), { recursive: true });
  writeFileSync(path.join(project, ".storytree.json"), JSON.stringify({ project: "planted-git" }));
  copyFileSync(process.execPath, path.join(project, "git.exe"));
  const mark = path.join(dir, "planted-git-ran");
  writeFileSync(path.join(project, "symbolic-ref"), `require("node:fs").writeFileSync(${JSON.stringify(mark)}, "ran");\n`);
  const home = path.join(dir, "home");
  mkdirSync(home);

  // Claude Code's shells set the variable themselves; the hook must not lean on its caller having done so.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "NODEFAULTCURRENTDIRECTORYINEXEPATH"));
  const run = promisify(execFile)(process.execPath, [hook!, "claude-code"], { cwd: project, env: { ...env, STORYTREE_HOME: home }, timeout: 60_000, windowsHide: true });
  run.child.stdin!.end(JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "session-planted-git", cwd: project, prompt: "hello" }));
  await run;

  assert.equal(existsSync(mark), false, "the git.exe planted in the project folder ran");
});

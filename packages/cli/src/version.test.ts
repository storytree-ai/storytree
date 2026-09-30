/** Capability 1 · Front door, contract 1.9: `storytree --version` names the build it comes from. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { run } from "./door.js";

test("1.9 from a source checkout, `storytree --version` prints the desktop app's 0.3.<n> for this commit, and its short commit", async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const git = (...args: string[]) => execFileSync("git", ["-C", here, ...args], { encoding: "utf8" }).trim();
  const [major, minor] = (JSON.parse(readFileSync(path.join(git("rev-parse", "--show-toplevel"), "apps/desktop/package.json"), "utf8")) as { version: string }).version.split(".");
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(["--version"], { cwd: here, out: (text) => out.push(text), err: (text) => err.push(text) });

  assert.equal(code, 0, err.join(""));
  assert.equal(out.join("").trim(), `storytree ${major}.${minor}.${git("rev-list", "--first-parent", "--count", "HEAD")} (${git("rev-parse", "--short=7", "HEAD")})`);
});

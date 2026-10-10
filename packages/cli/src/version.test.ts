/** Capability 1 · Front door, contract 1.9: `storytree --version` names the build it comes from. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildBins } from "@storytree/app-setup/bins";

import { run } from "./index.js";

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

test("1.9 an installed build, outside any checkout, prints the release's 0.3.<n> stamped into it at packaging", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree-installed-"));
  try {
    const { storytree } = await buildBins(dir, { release: { version: "0.3.42", commit: "abc1234" } });

    const printed = execFileSync(process.execPath, [storytree!, "--version"], { cwd: dir, encoding: "utf8" });

    assert.equal(printed.trim(), "storytree 0.3.42 (abc1234)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

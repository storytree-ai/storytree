/**
 * Capability 2 · Connect an agent: contract 2.21. The shape of Codex's hooks depends on the version Codex says it is,
 * so connecting reads it from the Codex the user would run: the one on the PATH, else the desktop app's own CLI.
 */
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { withTempDir } from "@storytree/project-and-caller/testing/folders";

import { installedCodexVersion } from "./codex.js";

test("2.21 the Codex version connecting reads is the one Codex on the PATH says (on Windows its npm .cmd, which only a shell runs), else the desktop app's CLI's, and none where no Codex answers", async () => {
  await withTempDir(async (dir) => {
    const bin = path.join(dir, "bin");
    const codexHome = path.join(dir, ".codex");
    const localAppData = path.join(dir, "AppData", "Local");
    for (const folder of [bin, codexHome, localAppData]) mkdirSync(folder, { recursive: true });
    const options = { path: bin, waitMs: 10_000, codexHome, localAppData, applications: [] };
    assert.equal(installedCodexVersion(options), undefined);

    // The desktop app's CLI stand-in is a Node, whose `--version` says Node's own version.
    const desktop = path.join(localAppData, "OpenAI", "Codex", "bin", "3f2a9c", "codex.exe");
    mkdirSync(path.dirname(desktop), { recursive: true });
    if (process.platform === "win32") copyFileSync(process.execPath, desktop);
    else symlinkSync(process.execPath, desktop);
    assert.equal(installedCodexVersion(options), process.versions.node);

    if (process.platform === "win32") writeFileSync(path.join(bin, "codex.cmd"), "@echo codex-cli 0.150.2\r\n");
    else {
      writeFileSync(path.join(bin, "codex"), "#!/bin/sh\necho codex-cli 0.150.2\n");
      chmodSync(path.join(bin, "codex"), 0o755);
    }
    assert.equal(installedCodexVersion(options), "0.150.2");
  });
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { summary } from "./desktop-lag.mjs";

test("8.2 desktop analysis preserves the measured CPU intervals and their function attribution", () => {
  const out = mkdtempSync(path.join(tmpdir(), "lag-profile-"));
  try {
    copyFileSync(new URL("../evidence/lag-allocation/runtime.cpuprofile", import.meta.url), path.join(out, "renderer.cpuprofile"));
    // Only the CPU profile is measured. This envelope supplies the other required analysis fields.
    writeFileSync(path.join(out, "result.json"), JSON.stringify({ state: "CPU-only fixture: desktop metrics unmeasured", readyMs: 0, marks: [], ipc: [], ev: [], clicks: [], loaf: [], lag: [], mem: {} }));
    const report = summary(out);
    const cli = execFileSync(process.execPath, [fileURLToPath(new URL("./desktop-lag.mjs", import.meta.url)), "--analyze", out], { encoding: "utf8" });
    assert.equal(cli.trimEnd(), report);
    // The frozen runtime capture has 122322 us total, 13916 us self and 100798 us inclusive.
    assert.match(report, /CPU profile: 122 ms\n/);
    const [self, inclusive] = report.split("Top self:\n")[1].split("\nTop inclusive:\n");
    assert.match(self, /^\s+14 measuredWork \[eval1\]:9$/m);
    assert.match(inclusive, /^\s+101 measuredWork \[eval1\]:9$/m);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

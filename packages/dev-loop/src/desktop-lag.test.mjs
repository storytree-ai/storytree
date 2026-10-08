import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { lagHome, summary } from "./desktop-lag.mjs";

test("8.3 pnpm lag:desktop --home starts cold on a new home and warm on one an earlier run left", () => {
  const from = mkdtempSync(path.join(tmpdir(), "lag-home-from-"));
  const home = path.join(mkdtempSync(path.join(tmpdir(), "lag-home-")), "run");
  try {
    writeFileSync(path.join(from, "settings.json"), '{"library":"cloud"}');
    writeFileSync(path.join(from, "auth.json"), '{"postgres":{"key":"synthetic"}}', { mode: 0o600 });
    const cold = lagHome({ home, homeFrom: from });
    assert.deepEqual(cold, { home, warm: false });
    assert.equal(readFileSync(path.join(home, "settings.json"), "utf8"), '{"library":"cloud"}');
    // The configured library's Postgres password (the `postgres` key in auth.json) comes too, readable by the user alone.
    const auth = path.join(home, "auth.json");
    assert.equal(readFileSync(auth, "utf8"), '{"postgres":{"key":"synthetic"}}');
    if (process.platform !== "win32") assert.equal(statSync(auth).mode & 0o777, 0o600);
    // The app keeps its reading under the home's electron folder; a run that left one is reused untouched.
    mkdirSync(path.join(home, "electron"));
    writeFileSync(path.join(home, "settings.json"), '{"library":"kept"}');
    assert.deepEqual(lagHome({ home, homeFrom: from }), { home, warm: true });
    assert.equal(readFileSync(path.join(home, "settings.json"), "utf8"), '{"library":"kept"}');
  } finally {
    rmSync(from, { recursive: true, force: true });
    rmSync(path.dirname(home), { recursive: true, force: true });
  }
});

test("8.2 pnpm lag:desktop analysis preserves the measured CPU intervals and their function attribution", () => {
  const out = mkdtempSync(path.join(tmpdir(), "lag-profile-"));
  try {
    copyFileSync(new URL("../evidence/lag-allocation/runtime.cpuprofile", import.meta.url), path.join(out, "renderer.cpuprofile"));
    // Only the CPU profile is measured. This envelope supplies the other required analysis fields.
    writeFileSync(path.join(out, "result.json"), JSON.stringify({ state: "CPU-only fixture: desktop metrics unmeasured", readyMs: 0, marks: [], ipc: [], ev: [], clicks: [], loaf: [], lag: [], mem: {} }));
    const report = summary(out);
    const cli = execFileSync(process.execPath, [process.env.npm_execpath, "--silent", "run", "lag:desktop", "--analyze", out], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)), encoding: "utf8", timeout: 30_000,
    });
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

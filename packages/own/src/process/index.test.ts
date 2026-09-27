import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { probeProcess, readProcess } from "./index.js";
import { readLinuxProcess } from "./linux.js";

test("2.3/2.4 native observation identifies one live process lifetime consistently", async () => {
  const reading = await readProcess(process.pid);
  assert.equal(reading.state, "live", JSON.stringify(reading));
  if (reading.state !== "live") return;
  assert.equal(reading.identity.pid, process.pid);
  assert.equal(reading.identity.platform, process.platform);
  assert.ok(reading.identity.started.length > 0);
  assert.ok(reading.identity.boot.length > 0);
  assert.deepEqual(await probeProcess(reading.identity), reading);
  assert.deepEqual(await probeProcess({ ...reading.identity, started: `${reading.identity.started}-another-lifetime` }), { state: "gone" });
  assert.deepEqual(await probeProcess({ ...reading.identity, boot: `${reading.identity.boot}-another-boot` }), { state: "gone" });
});

test("2.3 confirms an owned process has ended, including Windows exit code STILL_ACTIVE", async () => {
  const child = spawn(process.execPath, ["-e", "process.on('message', () => process.exit(259)); process.send('ready');"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const exited = once(child, "exit");
  try {
    await once(child, "message");
    assert.ok(child.pid);
    const reading = await readProcess(child.pid);
    assert.equal(reading.state, "live", JSON.stringify(reading));
    child.send("finish");
    await exited;
    if (reading.state !== "live") return;
    assert.deepEqual(await probeProcess(reading.identity), { state: "gone" });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
});

test("2.3 invalid process identifiers remain uncertain", async () => {
  for (const pid of [0, -1, 1.5, Number.NaN, 2 ** 32]) {
    const reading = await readProcess(pid);
    assert.equal(reading.state, "unknown");
  }
});

test("2.3 Linux distinguishes absent processes from unreadable or malformed evidence", async () => {
  for (const code of ["EACCES", "EIO"]) {
    const reading = await readLinuxProcess(42, async () => { throw Object.assign(new Error(code), { code }); });
    assert.equal(reading.state, "unknown");
  }
  assert.deepEqual(await readLinuxProcess(42, async (file) => {
    if (!file.endsWith("/stat")) return "boot-identity";
    throw Object.assign(new Error("absent"), { code: "ENOENT" });
  }, () => "gone"), { state: "gone" });
  assert.equal((await readLinuxProcess(42, async (file) => {
    if (!file.endsWith("/stat")) return "boot-identity";
    throw Object.assign(new Error("hidden by procfs"), { code: "ENOENT" });
  }, () => "unknown")).state, "unknown");
  assert.equal((await readLinuxProcess(42, async () => { throw Object.assign(new Error("procfs unavailable"), { code: "ENOENT" }); })).state, "unknown");
  assert.equal((await readLinuxProcess(42, async () => "broken proc data")).state, "unknown");
});

test("2.3/2.4 Linux uses exact boot and start ticks even with spaces and parentheses in command", async () => {
  // Fields 3 through 21 precede starttime (22); the command is permitted to contain ')'.
  const stat = `42 (a tricky ) command) S ${Array.from({ length: 18 }, () => "0").join(" ")} 9007199254740993 0`;
  const read = async (file: string): Promise<string> => file.endsWith("/stat") ? stat : "boot-identity\n";
  assert.deepEqual(await readLinuxProcess(42, read), {
    state: "live",
    identity: { pid: 42, platform: "linux", started: "9007199254740993", boot: "boot-identity" },
  });
  assert.deepEqual(await readLinuxProcess(42, async (file) => file.endsWith("/stat") ? stat.replace(") S ", ") Z ") : "boot-identity"), { state: "gone" });
  assert.equal((await readLinuxProcess(42, async (file) => {
    if (file.endsWith("/stat")) return stat;
    throw Object.assign(new Error("boot identity unavailable"), { code: "ENOENT" });
  })).state, "unknown");
});

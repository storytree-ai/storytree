/**
 * Capability 11 · Machines: this machine's health. Every reading here is handed over by the test, never the test
 * machine's own, and every settings home is thrown away after its test.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { setSetting } from "@storytree/project-and-caller";
import { withTempDir } from "@storytree/project-and-caller/testing/folders";
import { VerbRefusal, type DoorWords } from "@storytree/library/verbs";

import { concernsOf, healthSaid, linuxReadings, windowsReadings, type DiskBlocks, type LinuxSources, type WindowsSources } from "./health.js";
import { healthVerb } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
const LIMITS = { memoryGB: 6, load: 12, diskPercent: 85 };
const NOW = new Date("2026-10-21T12:00:00Z");
const GB = 1024 ** 3;

/** A disk of `size` GB with `used` GB used, all the rest a user's to use. */
function disk(size: number, used: number): DiskBlocks {
  return { bsize: 4096, blocks: (size * GB) / 4096, bfree: ((size - used) * GB) / 4096, bavail: ((size - used) * GB) / 4096 };
}

function linux(availableGB: number, load15: number, diskUsedGB: number): LinuxSources {
  return {
    now: NOW,
    uptimeSeconds: 2 * 86_400,
    meminfo: `MemTotal:       ${32 * 1024 * 1024} kB\nMemFree:          100000 kB\nMemAvailable:   ${availableGB * 1024 * 1024} kB\n`,
    loadavg: [1, 2, load15],
    disk: () => disk(100, diskUsedGB),
  };
}

function windows(freeGB: number, queue: string, diskUsedGB: number): WindowsSources {
  return { now: NOW, uptimeSeconds: 3600, freeBytes: freeGB * GB, totalBytes: 16 * GB, queue: () => queue, drive: "C:\\", disk: () => disk(200, diskUsedGB) };
}

test("11.5 · On Linux, machine health reads the boot time, MemAvailable, the 15-minute load and the root disk, and names a concern for memory under its limit, load over it and a disk fuller than it, or a reading it could not take", () => {
  const healthy = linuxReadings(linux(20, 3, 40));
  assert.equal(healthy.bootedAt.toISOString(), "2026-10-19T12:00:00.000Z");
  assert.deepEqual([healthy.memory?.availableGB, healthy.memory?.totalGB, healthy.load?.value, healthy.disk?.path, healthy.disk?.fullPercent], [20, 32, 3, "/", 40]);
  assert.deepEqual(concernsOf(healthy, LIMITS), []);

  const strained = linuxReadings(linux(4, 14.5, 90));
  assert.deepEqual(concernsOf(strained, LIMITS), [
    "memory: 4.0 GB available, under 6 GB",
    "load: 15-minute load 14.50, over 12",
    "disk: / 90% full, over 85%",
  ]);
  assert.deepEqual(concernsOf(strained, { memoryGB: 3, load: 15, diskPercent: 95 }), [], "the limits are what decide");

  const unread = linuxReadings({ ...linux(20, 3, 40), meminfo: "", disk: () => { throw new Error("EACCES: statfs /"); } });
  assert.deepEqual(concernsOf(unread, LIMITS), ["unread memory: /proc/meminfo gives no MemAvailable and MemTotal", "unread disk /: EACCES: statfs /"]);
});

test("11.6 · On Windows, machine health reads the boot time, the memory available, the processor queue and the system drive, and names a concern for each past its limit, or a queue PowerShell could not give", () => {
  const healthy = windowsReadings(windows(10, "2\r\n", 50));
  assert.equal(healthy.platform, "Windows");
  assert.equal(healthy.bootedAt.toISOString(), "2026-10-21T11:00:00.000Z");
  assert.deepEqual([healthy.memory?.availableGB, healthy.load?.what, healthy.load?.value, healthy.disk?.path, healthy.disk?.fullPercent], [10, "processor queue", 2, "C:\\", 25]);
  assert.deepEqual(concernsOf(healthy, LIMITS), []);

  const strained = windowsReadings(windows(2, "13", 190));
  assert.deepEqual(concernsOf(strained, LIMITS), [
    "memory: 2.0 GB available, under 6 GB",
    "load: processor queue 13, over 12",
    "disk: C:\\ 95% full, over 85%",
  ]);

  const failed = windowsReadings({ ...windows(10, "", 50), queue: () => { throw new Error("spawn powershell.exe ENOENT"); } });
  assert.deepEqual(concernsOf(failed, LIMITS), ["unread processor queue: spawn powershell.exe ENOENT"]);
  assert.deepEqual(concernsOf(windowsReadings(windows(10, "Access denied", 50)), LIMITS), ['unread processor queue: PowerShell said "Access denied", not a number']);
});

test("11.7 · `storytree machine health` reads the machine against the limits in settings: concerns come first and refuse, so the command exits 1, offering no next step, and a healthy machine answers with each reading", async () => {
  await withTempDir(async (home) => {
    const strained = linuxReadings(linux(4, 3, 40));
    const refused = await healthVerb(() => strained).act({}, { folder: home, home }, WORDS).then(() => undefined, (error: unknown) => error);
    assert.ok(refused instanceof VerbRefusal, "a concern refuses");
    assert.equal(refused.misuse, false);
    assert.deepEqual(refused.next, [], "it offers no `settings show`: each concern names its limit (ADR-1090)");
    assert.match(refused.message, /^1 concern on [^\n]+:\n {2}- memory: 4\.0 GB available, under 6 GB\n\nLinux, up since 2026-10-19 12:00 UTC\nmemory: 4\.0 GB available of 32\.0 GB\nload: 15-minute load 3\ndisk: \/ 40% full, 60\.0 GB free of 100\.0 GB$/);

    setSetting("health-memory", "3", home);
    const answer = await healthVerb(() => strained).act({}, { folder: home, home }, WORDS);
    assert.match(answer.text, /^No concerns on [^\n]+\.\n\nLinux, up since/);
    assert.deepEqual(answer.data?.concerns, []);
  });
  assert.equal(healthSaid(linuxReadings(linux(20, 3, 40)), [], "mint").split("\n")[0], "No concerns on mint.");
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { assessAllowance, detectLimitHit, laneSettings, pickEngine, readLatestAllowance } from "./engine.mjs";

const now = Date.parse("2026-10-06T00:00:00Z") / 1000;
const reading = (used, extra = {}) => ({
  at: new Date(now * 1000).toISOString(),
  secondary: { used_percent: used, window_minutes: 10080, resets_at: now + 7200 },
  ...extra,
});
async function folder(t) {
  const path = await mkdtemp(join(tmpdir(), "lane-engine-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("10.1 · reads the newest allowance event from the eight newest rollout files, skipping invalid and unrelated lines", async (t) => {
  const sessions = await folder(t);
  const day = join(sessions, "2026", "10", "06");
  await mkdir(day, { recursive: true });
  const event = (timestamp, used) => JSON.stringify({ timestamp, payload: { type: "token_count", rate_limits: { secondary: { used_percent: used } } } });
  for (let i = 0; i < 9; i++) {
    const path = join(day, `rollout-${i}.jsonl`);
    // The excluded oldest file has the newest event timestamp.
    await writeFile(path, event(i === 0 ? "2026-10-07T00:00:00Z" : `2026-10-06T00:00:0${i}Z`, i));
    await utimes(path, now + i, now + i);
  }
  const winner = join(day, "rollout-7.jsonl");
  await writeFile(winner, [
    event("2026-10-06T00:01:00Z", 94), "broken JSON", "null", "[]",
    JSON.stringify({ timestamp: "2026-10-08T00:00:00Z", payload: { type: "token_count" } }),
    event("2026-10-06T00:00:59Z", 12),
  ].join("\n"));
  await utimes(winner, now + 7, now + 7);
  await writeFile(join(day, "unrelated.jsonl"), event("2026-10-09T00:00:00Z", 100));
  assert.deepEqual(await readLatestAllowance(sessions), { at: "2026-10-06T00:01:00Z", secondary: { used_percent: 94 } });
  assert.equal(await readLatestAllowance(join(sessions, "missing")), null);
});

test("10.2 · expired and undated windows cannot spend the allowance; missing resets lapse after window_minutes", () => {
  assert.deepEqual(assessAllowance(reading(99), now), { used: 99, resets: now + 7200, reached: false });
  for (const window of [
    { used_percent: 100, resets_at: now },
    { used_percent: 100, resets_at: now - 1 },
    { used_percent: 100 },
  ]) {
    assert.deepEqual(assessAllowance(reading(0, { secondary: window, rate_limit_reached_type: "weekly" }), now), { used: null, resets: null, reached: false });
  }
  const fallback = reading(0, { primary: { used_percent: 96, window_minutes: 5 }, secondary: null });
  assert.equal(assessAllowance(fallback, now + 299).used, 96);
  assert.equal(assessAllowance(fallback, now + 300).used, null);
  assert.equal(assessAllowance({ ...fallback, at: "not a date" }, now).used, null);
  const both = reading(77, { primary: { used_percent: 98, resets_at: now + 3600 } });
  assert.deepEqual(assessAllowance(both, now), { used: 98, resets: now + 3600, reached: false });
  assert.equal(assessAllowance(both, now + 3600).used, 77);
});

test("10.3 · Codex is the default below 95 percent; a live reached flag and CODEX_STOP_AT can switch to Claude", async (t) => {
  const lanesDir = await folder(t);
  for (const [allowance, stopAt, engine] of [
    [null, 95, "codex"], [reading(94.99), 95, "codex"], [reading(95), 95, "claude"],
    [reading(100), 95, "claude"], [reading(77, { rate_limit_reached_type: "weekly" }), 95, "claude"],
    [reading(77), 75, "claude"], [reading(77), 80, "codex"],
    [reading(100, { secondary: { used_percent: 100, resets_at: now }, rate_limit_reached_type: "weekly" }), 95, "codex"],
  ]) assert.equal((await pickEngine({ lanesDir, reading: allowance, stopAt, now })).engine, engine);
  assert.equal(laneSettings({ home: lanesDir, env: {} }).stopAt, 95);
  assert.equal(laneSettings({ home: lanesDir, env: { CODEX_STOP_AT: "80" } }).stopAt, 80);
  assert.equal(laneSettings({ home: lanesDir, env: {} }).lanesDir, join(lanesDir, "storytree-lanes"));
  assert.equal(laneSettings({ env: { LANES_DIR: lanesDir } }).lanesDir, lanesDir);
});

test("10.4 · an override wins over an exhausted marker; invalid overrides and expired markers are ignored", async (t) => {
  const lanesDir = await folder(t);
  const pick = () => pickEngine({ lanesDir, reading: reading(77), now });
  await writeFile(join(lanesDir, "codex-exhausted-until"), `${now + 100}\n`);
  assert.equal((await pick()).engine, "claude");
  await writeFile(join(lanesDir, "engine-override"), " CODEX\n");
  assert.equal((await pick()).engine, "codex");
  await writeFile(join(lanesDir, "engine-override"), "invalid");
  assert.equal((await pick()).engine, "claude");
  for (const marker of [String(now), String(now - 1), "bad"]) {
    await writeFile(join(lanesDir, "codex-exhausted-until"), marker);
    assert.equal((await pick()).engine, "codex");
  }
  await writeFile(join(lanesDir, "engine-override"), "claude");
  assert.equal((await pick()).engine, "claude");
});

test("10.5 · only Codex's own usage-limit stop writes a marker, using the reset or a one-hour fallback", async (t) => {
  const lanesDir = await folder(t);
  const log = join(lanesDir, "lane.log"), err = join(lanesDir, "lane.err"), marker = join(lanesDir, "codex-exhausted-until");
  const run = async (events, stderr, allowance) => {
    await rm(marker, { force: true });
    await writeFile(log, ["not JSON", "null", ...events.map((event) => JSON.stringify(event))].join("\n"));
    await writeFile(err, stderr);
    const hit = await detectLimitHit({ log, err, lanesDir, reading: allowance, now });
    if (!hit) await assert.rejects(readFile(marker), { code: "ENOENT" });
    return hit;
  };
  for (const message of ["You've hit your usage limit", "usage limit", "usage_limit", "hit your usage", "hit your limit"]) {
    assert.equal(await run([{ type: "error", message }], "", reading(77)), true);
    assert.equal(Number(await readFile(marker, "utf8")), now + 3600);
  }
  assert.equal(await run([{ type: "turn.failed", error: { message: "You've hit your usage limit" } }], "", reading(95)), true);
  assert.equal(Number(await readFile(marker, "utf8")), now + 7200);
  assert.equal(await run([{ type: "turn.failed", error: "other failure" }], "", reading(95)), true);
  assert.equal(await run([], "USAGE LIMIT", null), true);
  for (const [events, stderr, allowance] of [
    [[{ type: "error", message: "usage limit" }, { type: "turn.completed" }], "usage limit", reading(100)],
    [[{ type: "item.completed", item: { type: "error", message: "usage limit / hook trust" } }], "", reading(100)],
    [[{ type: "item.completed", item: { type: "command_execution", aggregated_output: "usage_limit" } }], "", reading(100)],
    [[{ type: "turn.started" }], "", reading(100)],
    [[{ type: "error", message: "Rate limit reached (429)" }], "Rate limit reached", reading(77)],
  ]) assert.equal(await run(events, stderr, allowance), false);
});

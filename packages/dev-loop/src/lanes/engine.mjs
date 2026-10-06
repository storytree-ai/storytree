// Mint lane allowance and limit-stop policy (dev loop capability 10; ADR-0929).
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export function laneSettings({ home = homedir(), env = process.env } = {}) {
  return {
    home,
    lanesDir: env.LANES_DIR || join(home, "storytree-lanes"),
    sessionsDir: join(home, ".codex", "sessions"),
    stopAt: Number(env.CODEX_STOP_AT ?? 95),
  };
}

export async function readOptional(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function entries(path) {
  try { return await readdir(path, { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function* events(path) {
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event && typeof event === "object" && !Array.isArray(event)) yield event;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  } finally {
    lines.close();
    input.destroy();
  }
}

/** Stat the dated rollout files, but stream only the newest eight, as the box's reader does. */
export async function readLatestAllowance(sessionsDir, { newestFiles = 8 } = {}) {
  let directories = [sessionsDir];
  for (const pattern of [/^\d{4}$/, /^\d{2}$/, /^\d{2}$/]) {
    const next = [];
    for (const directory of directories) {
      for (const entry of await entries(directory)) {
        if (entry.isDirectory() && pattern.test(entry.name)) next.push(join(directory, entry.name));
      }
    }
    directories = next;
  }
  const files = [];
  for (const directory of directories) {
    for (const entry of await entries(directory)) {
      if (!entry.isFile() || !/^rollout-.*\.jsonl$/.test(entry.name)) continue;
      const path = join(directory, entry.name);
      try { files.push({ path, modified: (await stat(path)).mtimeMs }); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  files.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
  let latest = null, latestAt = -Infinity;
  for (const { path } of files.slice(0, newestFiles)) {
    for await (const event of events(path)) {
      const limits = event.payload?.rate_limits;
      if (!limits || typeof limits !== "object" || Array.isArray(limits)) continue;
      const at = Date.parse(event.timestamp);
      if (Number.isFinite(at) && at >= latestAt) {
        latestAt = at;
        latest = { ...limits, at: event.timestamp };
      }
    }
  }
  return latest;
}

export function assessAllowance(reading, now) {
  let used = null, resets = null;
  const taken = Date.parse(reading?.at) / 1000;
  for (const name of ["primary", "secondary"]) {
    const window = reading?.[name];
    if (!window || window.used_percent == null) continue;
    const percent = Number(window.used_percent);
    const until = Number.isFinite(window.resets_at) ? window.resets_at
      : Number.isFinite(window.window_minutes) ? taken + 60 * window.window_minutes : NaN;
    if (!Number.isFinite(percent) || !Number.isFinite(until) || until <= now) continue;
    if (used === null || percent > used) { used = percent; resets = until; }
  }
  return { used, resets, reached: Boolean(reading?.rate_limit_reached_type) && used !== null };
}

export const iso = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 16) + "Z";
export async function engineControls(lanesDir, now) {
  const override = (await readOptional(join(lanesDir, "engine-override"))).trim();
  const marker = Number((await readOptional(join(lanesDir, "codex-exhausted-until"))).trim());
  return { override, until: Number.isInteger(marker) && marker > now ? marker : null };
}

export async function pickEngine({ lanesDir, reading, now, stopAt = 95 }) {
  const { override, until } = await engineControls(lanesDir, now);
  const forced = override.toLowerCase();
  if (["codex", "claude"].includes(forced)) return { engine: forced, reason: `forced by ${join(lanesDir, "engine-override")}` };
  if (until !== null) return { engine: "claude", reason: `Codex stopped on its usage limit; Codex is tried again from ${iso(until)}` };
  if (!reading) return { engine: "codex", reason: "no Codex allowance reading yet" };
  const { used, resets, reached } = assessAllowance(reading, now);
  if (used === null) return { engine: "codex", reason: "no live Codex window in the last reading (reset since, or undated)" };
  return { engine: reached || used >= stopAt ? "claude" : "codex", reason: `Codex weekly allowance ${used}% used, resets ${iso(resets)}` };
}

async function stderrTail(path) {
  if (!path) return "";
  let file;
  try {
    file = await open(path, "r");
    const { size } = await file.stat();
    const bytes = Buffer.alloc(Math.min(size, 20000));
    await file.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length));
    return bytes.toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  } finally { await file?.close(); }
}

export async function detectLimitHit({ log, err, lanesDir, reading, now, stopAt = 95 }) {
  let lastTurn, failed = false, worded = false;
  const limitWords = /usage limit|usage_limit|hit your usage|hit your limit/i;
  for await (const event of events(log)) {
    if (typeof event.type === "string" && event.type.startsWith("turn.")) lastTurn = event.type;
    if (event.type === "error" || event.type === "turn.failed") {
      failed = true;
      worded ||= limitWords.test(JSON.stringify(event.type === "error" ? event.message : event.error));
    }
  }
  if (lastTurn === "turn.completed") return false;
  worded ||= limitWords.test(await stderrTail(err));
  const { used, resets, reached } = assessAllowance(reading, now);
  const spent = reached || (used !== null && used >= stopAt);
  if (!worded && !(failed && spent)) return false;
  const until = spent && resets > now ? resets : now + 3600;
  await mkdir(lanesDir, { recursive: true });
  await writeFile(join(lanesDir, "codex-exhausted-until"), `${Math.floor(until)}\n`);
  return true;
}

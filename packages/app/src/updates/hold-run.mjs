#!/usr/bin/env node
// Updates 4.12: standalone so an acceptance runner can copy this one file beside its scripts.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const [home, run, minutesText, command, ...args] = process.argv.slice(2);
const minutes = Number(minutesText);
if (!home?.trim() || !run?.trim() || !command || !Number.isFinite(minutes) || minutes <= 0 || minutes > 360) {
  console.error('Usage: node hold-run.mjs <storytree-home> <run-name> <minutes: >0 and <=360> <executable> [args...]');
  process.exit(2);
}

const directory = path.join(home, "update-holds");
const file = path.join(directory, `${randomUUID()}.json`);
const pending = `${file}.tmp`;
try {
  mkdirSync(directory, { recursive: true });
  const startedAt = Date.now();
  const expiresAt = startedAt + minutes * 60_000;
  writeFileSync(pending, JSON.stringify({ run, startedAt, expiresAt }), { flag: "wx" });
  renameSync(pending, file);
  console.error(`Automatic updates held for ${run} until ${new Date(expiresAt).toISOString()} or this command ends.`);
  // No shell reinterprets the command's arguments. A crashed wrapper leaves only the finite lease.
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rmSync(pending, { force: true });
  rmSync(file, { force: true });
}

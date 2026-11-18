import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { probeProcess, readProcess, type ProcessIdentity } from "@storytree/session-management/processes";
import { testChildArgs } from "@storytree/session-management/processes/testing";
import { removeTemp, waitUntil } from "@storytree/test-waits";

import { removeDevHome } from "./dev-home.js";

/** A long-lived stand-in for a database owner (it ends itself once this runner is gone), and its identity. */
async function standIn(): Promise<{ child: ChildProcess; identity: ProcessIdentity; exited: Promise<unknown[]> }> {
  const child = spawn(process.execPath, testChildArgs(), { stdio: "ignore", windowsHide: true });
  const exited = once(child, "exit");
  const identity = await waitUntil(async () => {
    const reading = await readProcess(child.pid!);
    return reading.state === "live" ? reading.identity : undefined;
  }, 10_000, `stand-in ${child.pid} to be readable`);
  return { child, identity, exited };
}

/** Kill a stand-in only while its pid still names it, never whatever process has since been given that pid. */
async function stop(identity: ProcessIdentity, exited: Promise<unknown>): Promise<void> {
  if ((await probeProcess(identity)).state !== "live") return;
  try { process.kill(identity.pid, "SIGKILL"); } catch { return; }
  await exited;
}

/** A dev home as makeDevHome leaves it, with no Postgres: its marker, its storytree home and the database owner's record. */
function fabricateHome(root: string, ownerPid: number, identity: ProcessIdentity | undefined) {
  const dir = path.join(root, "dev home");
  const storytree = path.join(dir, "home", ".storytree", "0.3");
  mkdirSync(storytree, { recursive: true, mode: 0o700 });
  const marker = path.join(dir, "storytree-dev-home.json");
  writeFileSync(marker, `${JSON.stringify({ made: "2026-11-18T00:00:00.000Z" })}\n`, { mode: 0o600 });
  const owner = path.join(storytree, "pgdata.owner.json");
  writeFileSync(owner, `${JSON.stringify({ pid: ownerPid, port: 54329 })}\n`);
  if (identity !== undefined) writeFileSync(path.join(storytree, "dev-database.json"), `${JSON.stringify(identity)}\n`);
  return { dir, marker, owner };
}

test("2.27 · removing a dev home whose owner record is stale (its pid names a process of another lifetime) signals nothing and removes the home", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "storytree dev home owner "));
  const stranger = await standIn();
  t.after(async () => { await stop(stranger.identity, stranger.exited); await removeTemp(root); });
  // The owner's recorded lifetime: same pid, another start, as when the owner died and its pid was handed on.
  const ownerLifetime: ProcessIdentity = { ...stranger.identity, started: `${stranger.identity.started}0` };
  const { dir } = fabricateHome(root, stranger.identity.pid, ownerLifetime);

  await removeDevHome(dir);

  assert.equal((await probeProcess(stranger.identity)).state, "live", "the process now holding the pid was not signalled");
  assert.equal(stranger.child.exitCode, null);
  assert.equal(stranger.child.signalCode, null);
  assert.equal(existsSync(dir), false, "the stale home was removed");
});

for (const unconfirmed of ["no identity recorded", "identity of another pid", "identity unreadable here"] as const) {
  test(`2.27 · removing a dev home keeps it, signalling nothing, when its live owner pid cannot be confirmed (${unconfirmed})`, async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "storytree dev home owner "));
    const live = await standIn();
    const other = unconfirmed === "identity of another pid" ? await standIn() : undefined;
    t.after(async () => {
      await stop(live.identity, live.exited);
      if (other !== undefined) await stop(other.identity, other.exited);
      await removeTemp(root);
    });
    const identity = unconfirmed === "no identity recorded" ? undefined
      : unconfirmed === "identity of another pid" ? other!.identity
      // Lifetime evidence from another platform: the probe can read neither live nor gone.
      : { ...live.identity, platform: process.platform === "win32" ? "linux" as const : "win32" as const };
    const { dir, marker, owner } = fabricateHome(root, live.identity.pid, identity);
    const ownerText = readFileSync(owner, "utf8");

    await assert.rejects(removeDevHome(dir), (error: Error) => {
      assert.ok(error.message.includes(`keeping ${dir}`), error.message);
      return true;
    });

    assert.equal((await probeProcess(live.identity)).state, "live", "the unconfirmed owner pid was not signalled");
    assert.equal(live.child.signalCode, null);
    if (other !== undefined) assert.equal((await probeProcess(other.identity)).state, "live", "the identity's own pid was not signalled");
    assert.equal(existsSync(marker), true, "the home was kept");
    assert.equal(readFileSync(owner, "utf8"), ownerText, "the owner record was kept as it was");
  });
}

test("2.27 · removing a dev home whose owner's recorded identity is confirmed live sends that owner SIGTERM and removes the home", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "storytree dev home owner "));
  const owner = await standIn();
  t.after(async () => { await stop(owner.identity, owner.exited); await removeTemp(root); });
  const { dir } = fabricateHome(root, owner.identity.pid, owner.identity);

  await removeDevHome(dir);

  const [code, signal] = await owner.exited;
  // Windows has no signals: process.kill ends the process outright, with exit code 1.
  if (process.platform === "win32") assert.equal(code, 1);
  else assert.equal(signal, "SIGTERM");
  assert.equal((await probeProcess(owner.identity)).state, "gone");
  assert.equal(existsSync(dir), false, "the home was removed");
});

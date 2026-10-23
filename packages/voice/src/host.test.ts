/** Capability 4 · The box service and its confinement, contracts 4.1-4.2: the door's copy refreshed from main, and its install. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { main, type HostIo } from "./bins/voice-host.js";
import { refresh, type RefreshSteps } from "./host.js";
import { gitRepo } from "./testing/door.js";

const scratch: string[] = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "storytree-voice-host-"));
  scratch.push(dir);
  return dir;
}

/** An origin with a main branch, the door's clone of it, and steps that record each install and restart. */
function copyOfMain() {
  const origin = gitRepo({ "README.md": "door\n", "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
  scratch.push(origin.dir);
  origin.git("branch", "-M", "main");
  const copy = path.join(tempDir(), "copy");
  execFileSync("git", ["clone", "-q", "--branch", "main", origin.dir, copy]);
  const calls: string[] = [];
  let failInstall = false;
  const steps: RefreshSteps = {
    git: (...args) => execFileSync("git", ["-C", copy, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
    install: () => {
      calls.push("install");
      if (failInstall) throw new Error("frozen lockfile out of date");
    },
    restart: () => {
      calls.push("restart");
    },
  };
  const land = (file: string, text: string) => {
    writeFileSync(path.join(origin.dir, file), text);
    origin.git("add", "-A");
    origin.git("commit", "-q", "-m", `change ${file}`);
    return origin.git("rev-parse", "HEAD").trim();
  };
  const head = () => steps.git("rev-parse", "HEAD");
  return { steps, calls, land, head, failNextInstall: () => (failInstall = true) };
}

test("4.1 the refresh fast-forwards the copy to main, reinstalling only on a lockfile change and restarting only when HEAD moved", () => {
  const box = copyOfMain();
  const start = box.head();

  assert.deepEqual(refresh(box.steps), { moved: false, head: start });
  assert.deepEqual(box.calls, [], "main has not moved: no install, no restart");

  const code = box.land("door.ts", "export {};\n");
  assert.deepEqual(refresh(box.steps), { moved: true, from: start, to: code, reinstalled: false });
  assert.equal(box.head(), code);
  assert.deepEqual(box.calls, ["restart"], "code moved, lockfile did not: restart only");

  box.calls.length = 0;
  const lock = box.land("pnpm-lock.yaml", "lockfileVersion: '9.0'\npackages: {}\n");
  assert.deepEqual(refresh(box.steps), { moved: true, from: code, to: lock, reinstalled: true });
  assert.deepEqual(box.calls, ["install", "restart"], "the lockfile changed: install, then restart");
});

test("4.1 a failed install puts the copy back where it was and restarts nothing, so the next refresh tries the move again", () => {
  const box = copyOfMain();
  const start = box.head();
  const lock = box.land("pnpm-lock.yaml", "lockfileVersion: '9.0'\npackages: {}\n");
  box.failNextInstall();

  assert.throws(() => refresh(box.steps), /install .* failed, so the copy is back at/);
  assert.equal(box.head(), start);
  assert.deepEqual(box.calls, ["install"]);

  box.calls.length = 0;
  assert.throws(() => refresh(box.steps));
  assert.deepEqual(box.calls, ["install"], "the same move is tried again on the next run");
  assert.notEqual(box.head(), lock);
});

function hostIo(home: string, sourceRepo: string): HostIo & { lines: string[]; runs: string[] } {
  const lines: string[] = [];
  const runs: string[] = [];
  return {
    home,
    node: "/opt/node/bin/node",
    sourceRepo,
    lines,
    runs,
    say: (line) => lines.push(line),
    run: (command, args) => {
      runs.push([command, ...args].join(" "));
    },
  };
}

function boxHome(): string {
  const home = tempDir();
  mkdirSync(path.join(home, ".config", "storytree-voice-spike"), { recursive: true });
  writeFileSync(path.join(home, ".config", "storytree-voice-spike", "env"), "VOICE_SPIKE_TOKEN=never-read\n");
  return home;
}

test("4.2 install --dry-run names the copy, its env file and the three units, and changes nothing", () => {
  const source = gitRepo({ "README.md": "source\n" });
  scratch.push(source.dir);
  source.git("remote", "add", "origin", "https://example.invalid/storytree.git");
  const home = boxHome();
  const io = hostIo(home, source.dir);

  assert.equal(main(["install", "--dry-run"], io), 0);
  assert.deepEqual(io.runs, []);
  assert.deepEqual(readdirSync(home), [".config"]);
  assert.deepEqual(readdirSync(path.join(home, ".config")), ["storytree-voice-spike"]);
  const plan = io.lines.join("\n");
  assert.match(plan, /would clone https:\/\/example\.invalid\/storytree\.git \(main\) into .*storytree-voice-door/);
  for (const unit of ["storytree-voice.service", "storytree-voice-refresh.service", "storytree-voice-refresh.timer"]) assert.match(plan, new RegExp(`would write .*${unit.replace(/\./g, "\\.")}`));
  assert.match(plan, /roll back: systemctl --user disable --now storytree-voice && systemctl --user enable --now storytree-voice-spike/);
});

test("4.2 install keeps the secret in the spike's env file, points the door at its own copy, enables only the timer, and refuses the pool's checkout", () => {
  const source = gitRepo({ "README.md": "source\n", "agent-pool.json": JSON.stringify({ checkout: "~/pool-checkout" }) });
  scratch.push(source.dir);
  const home = boxHome();
  mkdirSync(path.join(home, "pool-checkout"));
  const copy = path.join(home, "storytree-voice-door");
  mkdirSync(copy);
  const io = hostIo(home, source.dir);

  assert.equal(main(["install"], io), 0);
  assert.deepEqual(io.runs, ["systemctl --user daemon-reload", "systemctl --user enable --now storytree-voice-refresh.timer"], "the copy is there: no clone; the door itself is not started");
  const envFile = path.join(home, ".config", "storytree-voice", "env");
  assert.equal(readFileSync(envFile, "utf8"), `REPO_DIR=${realpathSync(copy)}\n`);
  if (process.platform !== "win32") assert.equal(statSync(envFile).mode & 0o777, 0o600);
  const service = readFileSync(path.join(home, ".config", "systemd", "user", "storytree-voice.service"), "utf8");
  const envFiles = service.split("\n").filter((line) => line.startsWith("EnvironmentFile="));
  assert.deepEqual(envFiles, [`EnvironmentFile=${home}/.config/storytree-voice-spike/env`, `EnvironmentFile=${home}/.config/storytree-voice/env`], "the door's REPO_DIR is read last, so it wins");
  assert.match(service, /^ExecStart=\/opt\/node\/bin\/node .*storytree-voice-door\/packages\/voice\/src\/bins\/voice\.ts$/m);

  const refused = hostIo(home, source.dir);
  assert.equal(main(["install", "--repo-dir", path.join(home, "pool-checkout")], refused), 1);
  assert.match(refused.lines.join("\n"), /needs its own copy, not the pool's checkout/);
  assert.deepEqual(refused.runs, []);
});

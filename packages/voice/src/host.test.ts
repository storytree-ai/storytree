/** Capability 4 · The box service and its confinement, contracts 4.1-4.2 and 4.6: the door's copy refreshed from main, its install, and its confined units. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { removeTemp } from "@storytree/test-waits";

import { main, type HostIo } from "./bins/voice-host.js";
import { DOOR_LINK_ENV, RESTART_REQUEST_ENV, SYSTEM_PATHS, VOICE_USER, boxSteps, doorCode, refresh, refreshDoor, systemUnits, type DoorSteps, type RefreshSteps } from "./host.js";
import { gitRepo } from "./testing/door.js";

const scratch: string[] = [];
after(async () => {
  for (const dir of scratch) await removeTemp(dir);
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
  const commitInCopy = () => {
    writeFileSync(path.join(copy, "ahead.txt"), "not on main yet\n");
    steps.git("add", "-A");
    steps.git("-c", "user.name=voice test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "ahead of main");
    return head();
  };
  return { steps, calls, land, head, commitInCopy, failNextInstall: () => (failInstall = true) };
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

test("4.1 a copy ahead of main stays where it is and restarts nothing", () => {
  const box = copyOfMain();
  const ahead = box.commitInCopy();
  assert.deepEqual(refresh(box.steps), { moved: false, head: ahead });
  assert.deepEqual(box.calls, []);
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

/** A unit file's settings, as name to every value it is given. */
function settings(unit: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const line of unit.split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0 || line.startsWith("#")) continue;
    const [name, value] = [line.slice(0, at), line.slice(at + 1)];
    found.set(name, [...(found.get(name) ?? []), value]);
  }
  return found;
}

test("4.6 the confined units run the door and its refresh as the door's own user, with no home folders, no new privileges and a 3 GB cap, and nothing in them under a home folder", () => {
  const units = systemUnits();
  assert.deepEqual(Object.keys(units).sort(), ["storytree-voice-refresh.service", "storytree-voice-refresh.timer", "storytree-voice-restart.path", "storytree-voice-restart.service", "storytree-voice.service"]);
  for (const file of ["storytree-voice.service", "storytree-voice-refresh.service"]) {
    const unit = settings(units[file]!);
    assert.deepEqual(unit.get("User"), [VOICE_USER], file);
    assert.deepEqual(unit.get("ProtectHome"), ["true"], file);
    assert.deepEqual(unit.get("NoNewPrivileges"), ["true"], file);
    assert.deepEqual(unit.get("ProtectSystem"), ["strict"], file);
    assert.deepEqual(unit.get("MemoryMax"), ["3G"], file);
    assert.ok(unit.get("Environment")!.includes(`STORYTREE_HOME=${SYSTEM_PATHS.storytreeHome}`), file);
  }
  const door = settings(units["storytree-voice.service"]!);
  assert.deepEqual(door.get("EnvironmentFile"), [SYSTEM_PATHS.env], "the secret is read from /etc, not the owner's home");
  assert.match(door.get("ExecStart")![0]!, new RegExp(`^${SYSTEM_PATHS.node} --import file://${SYSTEM_PATHS.door}/node_modules/tsx/dist/loader\\.mjs ${SYSTEM_PATHS.door}/src/bins/voice\\.ts$`), "the door runs the code its link points at");
  const refreshUnit = settings(units["storytree-voice-refresh.service"]!);
  assert.ok(refreshUnit.get("Environment")!.includes(`${DOOR_LINK_ENV}=${SYSTEM_PATHS.door}`), "the refresh points that link");
  assert.ok(refreshUnit.get("Environment")!.includes(`REPO_DIR=${SYSTEM_PATHS.repoDir}`), "and refreshes the base copy wherever its own code is");
  for (const [file, text] of Object.entries(units)) assert.doesNotMatch(text, /\/home\/|~\//, `${file} names a path under a home folder`);
});

test("4.6 the confined refresh asks for a restart by rewriting the request file the restart path unit watches, and that unit's service restarts the door", () => {
  const units = systemUnits();
  const refreshUnit = settings(units["storytree-voice-refresh.service"]!);
  assert.ok(refreshUnit.get("Environment")!.includes(`${RESTART_REQUEST_ENV}=${SYSTEM_PATHS.restartRequest}`));
  assert.deepEqual(settings(units["storytree-voice-restart.path"]!).get("PathChanged"), [SYSTEM_PATHS.restartRequest]);
  const restart = settings(units["storytree-voice-restart.service"]!);
  assert.equal(restart.get("User"), undefined, "the restart runs as root, which the door's user is not");
  assert.deepEqual(restart.get("ExecStart"), ["/usr/bin/systemctl try-restart storytree-voice.service"]);

  const request = path.join(tempDir(), "restart-request");
  const before = process.env[RESTART_REQUEST_ENV];
  process.env[RESTART_REQUEST_ENV] = request;
  try {
    boxSteps(tempDir()).restart();
  } finally {
    if (before === undefined) delete process.env[RESTART_REQUEST_ENV];
    else process.env[RESTART_REQUEST_ENV] = before;
  }
  assert.ok(existsSync(request), "the refresh wrote the request file rather than calling systemctl");
  assert.match(readFileSync(request, "utf8"), /^\d{4}-\d{2}-\d{2}T/);
});

test("4.6 system-units --dry-run names the five units and writes nothing; without it, it writes them", () => {
  const dir = tempDir();
  const io = hostIo(tempDir(), tempDir());
  assert.equal(main(["system-units", "--dry-run", "--dir", dir], io), 0);
  assert.deepEqual(readdirSync(dir), []);
  assert.equal(io.lines.filter((line) => line.startsWith("would write ")).length, 5);
  assert.equal(main(["system-units", "--dir", dir], io), 0);
  assert.deepEqual(readdirSync(dir).sort(), Object.keys(systemUnits()).sort());
  assert.equal(readFileSync(path.join(dir, "storytree-voice.service"), "utf8"), systemUnits()["storytree-voice.service"]);
});

test("4.7 door-env copies only the door's own settings from the spike's env file, dropping every path the confined unit sets itself, and writes nothing on --dry-run", () => {
  const dir = tempDir();
  const from = path.join(dir, "spike-env");
  const to = path.join(dir, "door-env");
  writeFileSync(
    from,
    [
      "# the spike's settings",
      "VOICE_SPIKE_TOKEN=secret-one",
      "REPO_DIR=/home/owner/code/storytree03",
      "PORT=8787",
      "STORYTREE_CLI=[\"/home/owner/.nvm/node\"]",
      "ALLOWED_HOSTS=mint.example.ts.net",
      "HOME=/home/owner",
      "STORYTREE_HOME=/home/owner/.storytree/0.3",
      "PATH=/home/owner/.nvm/bin:/usr/bin",
      "ALLOWED_CIDRS=160.79.104.0/21",
      "",
    ].join("\n"),
  );
  const io = hostIo(tempDir(), tempDir());
  assert.equal(main(["door-env", "--from", from, "--to", to, "--dry-run"], io), 0);
  assert.equal(existsSync(to), false, "a dry run writes nothing");

  assert.equal(main(["door-env", "--from", from, "--to", to], io), 0);
  const kept = settings(readFileSync(to, "utf8"));
  assert.deepEqual([...kept.keys()].sort(), ["ALLOWED_CIDRS", "ALLOWED_HOSTS", "PORT", "VOICE_SPIKE_TOKEN"]);
  assert.deepEqual(kept.get("VOICE_SPIKE_TOKEN"), ["secret-one"]);
  if (process.platform !== "win32") assert.equal(statSync(to).mode & 0o777, 0o600, "the secret is readable by its owner only");
  const said = io.lines.join("\n");
  assert.match(said, /REPO_DIR, STORYTREE_CLI, HOME, STORYTREE_HOME, PATH/, "it names what it dropped");
  assert.doesNotMatch(said, /secret-one/, "it never prints the secret");
});

/** A folder a door's code may be in: the base copy's voice package, or a factory plugin. */
function codeAt(...parts: string[]): string {
  const dir = path.join(...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("4.10 the door's code is the one the part switch names: the base copy's voice package while voice is on, the factory plugin standing in while switched to one, none while off; voice-host part switches it in the door's own settings and refuses anything else", () => {
  const home = tempDir();
  const repo = tempDir();
  const io = { ...hostIo(tempDir(), repo), storytreeHome: home };

  assert.equal(doorCode(repo, home), path.join(repo, "packages", "voice"), "nothing switched: the base copy");
  assert.equal(main(["part", "voice", "plugin", "voice"], io), 0);
  assert.match(io.lines.join("\n"), /voice is switched to the factory plugin voice/);
  assert.equal(doorCode(repo, home), path.join(home, "your-factory", "plugins", "voice"), "the door's own factory folder, inside its storytree home");
  assert.equal(main(["part", "voice", "off"], io), 0);
  assert.equal(doorCode(repo, home), undefined, "off with no plugin standing in: no door");
  assert.equal(main(["part", "voice", "on"], io), 0);
  assert.equal(doorCode(repo, home), path.join(repo, "packages", "voice"), "switched back on: the base copy again");

  const refused = { ...hostIo(tempDir(), repo), storytreeHome: home };
  assert.equal(main(["part", "forest", "off"], refused), 1);
  assert.match(refused.lines.join("\n"), /no part called forest/);
  assert.equal(main(["part", "voice", "plugin"], refused), 1);
  assert.equal(doorCode(repo, home), path.join(repo, "packages", "voice"), "a refused switch saves nothing");
});

test("4.10 the door's refresh keeps the base copy and the factory clone at main, points the door's link at the code the switch names, and asks for one restart when either moved or the link changed", () => {
  const base = copyOfMain();
  const factory = copyOfMain();
  const dir = tempDir();
  const link = path.join(dir, "voice");
  const builtIn = codeAt(dir, "repo", "packages", "voice");
  const plugin = codeAt(dir, "factory", "plugins", "voice");
  let code: string | undefined = builtIn;
  let restarts = 0;
  const steps = (): DoorSteps => ({ base: base.steps, factory: factory.steps, link, code: () => code, restart: () => restarts++ });
  const pointsAt = () => (existsSync(link) ? realpathSync(link) : undefined);

  assert.equal(refreshDoor(steps()).relinked, true);
  assert.equal(pointsAt(), realpathSync(builtIn));
  assert.equal(restarts, 1, "the link was made: one restart");

  assert.equal(refreshDoor(steps()).relinked, false);
  assert.equal(restarts, 1, "nothing moved and the link is right: no restart");

  const landed = factory.land("plugin.ts", "export {};\n");
  base.land("door.ts", "export {};\n");
  const both = refreshDoor(steps());
  assert.equal(both.factory?.moved && both.factory.to, landed);
  assert.equal(restarts, 2, "both copies moved: still one restart");
  assert.deepEqual([...base.calls, ...factory.calls], [], "the restart is the door's, never a copy's own");

  code = plugin;
  assert.equal(refreshDoor(steps()).relinked, true);
  assert.equal(pointsAt(), realpathSync(plugin));
  assert.equal(restarts, 3, "switched to the plugin: relinked and restarted");

  code = undefined;
  assert.equal(refreshDoor(steps()).relinked, true);
  assert.equal(pointsAt(), undefined, "switched off: the link is gone, so the door does not start");
  assert.equal(restarts, 4);

  code = builtIn;
  refreshDoor(steps());
  base.land("again.ts", "export {};\n");
  factory.land("pnpm-lock.yaml", "lockfileVersion: '9.0'\npackages: {}\n");
  factory.failNextInstall();
  assert.throws(() => refreshDoor(steps()), /install .* failed/);
  assert.equal(restarts, 6, "the factory clone's install failed, but the base copy moved: the door still restarts on it");
  const { factory: _clone, ...withoutFactory } = steps();
  assert.equal(refreshDoor(withoutFactory).relinked, false, "no factory clone: only the base copy is refreshed");
});

test("4.10 voice-host refresh on the confined unit refreshes the base copy REPO_DIR names, wherever its own code is, and points the door's link at that copy's voice", () => {
  const origin = gitRepo({ "packages/voice/README.md": "voice\n", "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
  scratch.push(origin.dir);
  origin.git("branch", "-M", "main");
  const dir = tempDir();
  const repo = path.join(dir, "repo");
  execFileSync("git", ["clone", "-q", "--branch", "main", origin.dir, repo]);
  const link = path.join(dir, "voice");
  const request = path.join(dir, "restart-request");
  const env = { [DOOR_LINK_ENV]: link, REPO_DIR: repo, [RESTART_REQUEST_ENV]: request, STORYTREE_HOME: path.join(dir, "storytree") };
  const before = Object.fromEntries(Object.keys(env).map((name) => [name, process.env[name]]));
  Object.assign(process.env, env);
  const io = hostIo(tempDir(), tempDir());
  try {
    assert.equal(main(["refresh"], io), 0);
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.equal(realpathSync(link), realpathSync(path.join(repo, "packages", "voice")));
  assert.ok(io.lines.join("\n").includes(`door's code now ${path.join(repo, "packages", "voice")}; restarted storytree-voice`), io.lines.join("\n"));
  assert.ok(existsSync(request), "the restart was asked for through the request file");
});

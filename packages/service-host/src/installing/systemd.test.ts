/** Capability 3 · Keeping the host running, contracts 3.1 and 3.2: the Mint box's storytree-host.service, and `services install` / `services uninstall` writing and removing it. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";

import { removeTemp } from "@storytree/test-waits";

import { checkoutOf, hostUnit, installHost, uninstallHost, UNIT_NAME, userSystemd } from "./systemd.js";

function tempDir(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "storytree-host-unit-")));
  t.after(() => removeTemp(dir));
  return dir;
}

/** A stand-in node at `bin`/node that writes the folder it ran in and its arguments to `said`. */
function fakeNode(bin: string, said: string): void {
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "node"), `#!/bin/sh\nprintf '%s\\n' "${bin}" "$PWD" "$@" > "${said}"\n`);
  chmodSync(path.join(bin, "node"), 0o755);
}

test("3.1 · The box's storytree-host.service runs node itself on `storytree services run` in storytree's checkout, found under nvm when the user manager's PATH has none, with Restart=always, and a stop reaches the host alone", { skip: process.platform !== "linux" && "platform: a systemd user unit is the Linux entry point" }, (t) => {
  const dir = tempDir(t);
  const checkout = path.join(dir, "storytree");
  mkdirSync(checkout);
  const unit = hostUnit(checkout);
  assert.match(unit, /^\[Service\]$/m);
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^KillMode=mixed$/m, "a stop signals the host alone, which stops its own services before systemd kills what is left");
  assert.match(unit, /^WantedBy=default\.target$/m);
  assert.equal(unit.match(/^WorkingDirectory=(.*)$/m)?.[1], checkout);
  const script = unit.match(/^ExecStart=\/bin\/bash -c '(.*)'$/m)?.[1]?.replaceAll("$$", "$");
  assert.ok(script !== undefined, "ExecStart runs one bash line");

  const home = path.join(dir, "home");
  const said = path.join(dir, "said");
  fakeNode(path.join(home, ".nvm/versions/node/v24.9.0/bin"), said);
  fakeNode(path.join(home, ".nvm/versions/node/v24.19.0/bin"), said);
  const run = (PATH: string) => {
    execFileSync("/bin/bash", ["-c", script], { cwd: checkout, env: { HOME: home, PATH } });
    return readFileSync(said, "utf8").trim().split("\n");
  };
  assert.deepEqual(run("/usr/bin:/bin"), [path.join(home, ".nvm/versions/node/v24.19.0/bin"), checkout, "--import", "tsx", "packages/cli/src/bins/storytree.ts", "services", "run"], "with no node on PATH, the newest under nvm runs the host, as node itself");
  const own = path.join(dir, "own-node");
  fakeNode(own, said);
  assert.equal(run(`${own}:/usr/bin:/bin`)[0], own, "a node already on PATH is the one that runs");
});

test("3.2 · storytree services install writes, enables and starts the unit, again idempotently; services uninstall stops, disables and removes it", (t) => {
  const dir = tempDir(t);
  const unitDir = path.join(dir, "config", "systemd", "user");
  const calls: string[] = [];
  const systemctl = (args: readonly string[]) => { calls.push(args.join(" ")); };
  const file = path.join(unitDir, UNIT_NAME);

  assert.match(installHost("/srv/storytree", { unitDir, systemctl }), /^Wrote .*storytree-host\.service.*started/);
  assert.match(readFileSync(file, "utf8"), /^WorkingDirectory=\/srv\/storytree$/m);
  assert.deepEqual(calls.splice(0), ["daemon-reload", `enable ${UNIT_NAME}`, `restart ${UNIT_NAME}`]);

  assert.match(installHost("/srv/storytree", { unitDir, systemctl }), /already installed/);
  assert.deepEqual(calls.splice(0), [`enable ${UNIT_NAME}`, `start ${UNIT_NAME}`], "installing again rewrites nothing and leaves a running host running");

  installHost("/srv/storytree-moved", { unitDir, systemctl });
  assert.match(readFileSync(file, "utf8"), /^WorkingDirectory=\/srv\/storytree-moved$/m);
  assert.deepEqual(calls.splice(0), ["daemon-reload", `enable ${UNIT_NAME}`, `restart ${UNIT_NAME}`], "a changed unit is rewritten and the host restarted on it");

  assert.match(uninstallHost({ unitDir, systemctl }), /^Stopped and removed/);
  assert.equal(existsSync(file), false);
  assert.deepEqual(calls.splice(0), [`disable --now ${UNIT_NAME}`, "daemon-reload"]);
  assert.match(uninstallHost({ unitDir, systemctl }), /^No storytree-host\.service is installed/);
  assert.deepEqual(calls, [], "with none installed, uninstall touches nothing");

  assert.equal(userSystemd({}, "/home/me").unitDir, path.join("/home/me", ".config", "systemd", "user"), "the user's units live under ~/.config");
  assert.equal(userSystemd({ XDG_CONFIG_HOME: "/cfg" }, "/home/me").unitDir, path.join("/cfg", "systemd", "user"), "or under XDG_CONFIG_HOME, as systemd reads it");

  const checkout = path.join(dir, "checkout");
  mkdirSync(path.join(checkout, ".git"), { recursive: true });
  assert.equal(checkoutOf(path.join(checkout, "packages", "service-host")), checkout, "the unit runs the checkout the command runs from");
  const worktree = path.join(dir, "worktree");
  mkdirSync(path.join(worktree, "packages", "service-host"), { recursive: true });
  writeFileSync(path.join(worktree, ".git"), "gitdir: /elsewhere\n");
  assert.throws(() => checkoutOf(path.join(worktree, "packages", "service-host")), /a git worktree.*goes away/);
});

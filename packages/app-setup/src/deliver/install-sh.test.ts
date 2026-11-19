import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./install.sh", import.meta.url));
const steps = fileURLToPath(new URL("./install.test.sh", import.meta.url));
const linuxSteps = fileURLToPath(new URL("./install-linux.test.sh", import.meta.url));
for (const shell of ["sh", "bash", "zsh"]) {
  test(`1.10 / 1.12 / 1.15 / 1.18 under ${shell}: the macOS one-liner refuses another system or chip, takes the channel's release and says how to change an installed app's channel, says on stable the day its build was published and that later work is only in alpha, checks its checksum and installs only an app signed by storytree's Apple team that Gatekeeper accepts, writes one marked .zprofile line once, asks nothing once installed but says first how to open the app, and run again updates an older app`, {
    skip: process.platform === "win32" && "platform:posix: the Mac's one-liner runs under a POSIX shell, which Windows CI does not provide",
  }, (t) => {
    const found = spawnSync(shell, ["-c", "exit 0"]);
    if (found.error && process.platform !== "darwin") return t.skip(`platform:darwin: ${shell} unavailable here; macOS CI runs this proof`);
    assert.ifError(found.error);
    const result = spawnSync(shell, [steps, script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /install\.sh PASS/);
  });
  test(`1.13 under ${shell}: on x64 Linux the same one-liner refuses another chip, installs where FUSE cannot be used (no libfuse2, or a /dev/fuse this user cannot open) and runs the app unpacked there, saying so, takes the release's AppImage, installs it with its agent tools and icon under ~/.local/share/storytree-0.3 and a menu entry that starts it, reads its version from the AppImage, and writes the PATH line to ~/.profile`, {
    skip: process.platform === "win32" && "platform:posix: the one-liner runs under a POSIX shell, which Windows CI does not provide",
  }, (t) => {
    const found = spawnSync(shell, ["-c", "exit 0"]);
    if (found.error && process.platform !== "darwin") return t.skip(`platform:darwin: ${shell} unavailable here; macOS CI runs this proof`);
    assert.ifError(found.error);
    const result = spawnSync(shell, [linuxSteps, script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /install\.sh PASS/);
  });
}

test("1.14 on Linux and macOS, the one-liner makes storytree's home readable by its owner alone (0700), and the release channel record it saves there 0600", {
  skip: process.platform === "win32" && "platform:posix: the one-liner runs under a POSIX shell, which Windows CI does not provide",
}, () => {
  const root = mkdtempSync(path.join(tmpdir(), "storytree-home-"));
  try {
    const home = path.join(root, ".storytree", "0.3");
    const result = spawnSync("sh", ["-c", 'umask 022; STORYTREE_INSTALL_LIBRARY=1; . "$1"; st_save_channel "$2" stable', "sh", script, home], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const folder of [path.dirname(home), home]) assert.equal(statSync(folder).mode & 0o777, 0o700, folder);
    assert.equal(statSync(path.join(home, "release-channel.json")).mode & 0o777, 0o600);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const QUIT = [
  'STORYTREE_INSTALL_LIBRARY=1; . "$1"',
  'ST_SYSTEM=$2; ps=$4; after=$5; log=$6',
  'pgrep() { [ "$1" = -f ] || return 2; grep -E -q -- "$2" "$ps"; }',
  'sleep() { echo slept >> "$log"; cp "$after" "$ps"; }',
  'st_op_quit "$3"; echo "status $?"',
].join("\n");

function quit(system: "linux" | "darwin", running: string[], after: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), "storytree-quit-"));
  try {
    const dir = path.join(root, "Applications", "storytree-0.3.app");
    const exe = system === "linux" ? path.join(dir, "storytree-0.3") : path.join(dir, "Contents", "MacOS", "storytree-0.3");
    const log = path.join(root, "said.log"), ps = path.join(root, "ps.txt"), later = path.join(root, "later.txt");
    mkdirSync(path.dirname(exe), { recursive: true });
    writeFileSync(exe, `#!/bin/sh\nprintf 'asked %s\\n' "$*" >> '${log}'\n`, { mode: 0o755 });
    const lines = (list: string[]) => list.map((line) => line.replaceAll("<exe>", exe).replaceAll("<dir>", dir) + "\n").join("");
    writeFileSync(ps, lines(running));
    writeFileSync(later, lines(after));
    const result = spawnSync("sh", ["-c", QUIT, "sh", script, system, dir, ps, later, log], { encoding: "utf8" });
    const said = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
    return { status: result.stdout.trim() || result.stderr, said: said.length > 3 ? [...said.slice(0, 3), `... ${said.length} lines`] : said };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("1.3 · repeating the command while the app is open asks only a process whose command line starts with the installed app's executable (alone or with arguments) to quit and waits until it is gone, on Linux and macOS; when the only processes whose command line holds that path are a shell, a pgrep, an editor or a sibling executable beside it, it returns at once, asking nothing", {
  skip: process.platform === "win32" && "platform:posix: the one-liner runs under a POSIX shell, which Windows CI does not provide",
}, () => {
  const bystanders = ["bash -c pgrep -f <exe> >/dev/null; echo", "sh -c sleep 30; : <exe>", "/usr/bin/vim <exe>", "<exe>-old --type=gpu"];
  const quitAndWaited = { status: "status 0", said: ["asked --quit", "slept"] };
  const left = { status: "status 0", said: [] };
  assert.deepEqual(quit("linux", ["<exe> --no-sandbox", ...bystanders], bystanders), quitAndWaited);
  assert.deepEqual(quit("linux", ["<exe>"], []), quitAndWaited);
  assert.deepEqual(quit("darwin", ["<exe>", ...bystanders], bystanders), quitAndWaited);
  assert.deepEqual(quit("linux", bystanders, bystanders), left);
  assert.deepEqual(quit("darwin", bystanders, bystanders), left);
});

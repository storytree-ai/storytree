import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// install.sh is POSIX sh: run by sh under curl | sh, and promised under bash and zsh. On macOS all three are
// required (zsh is the Mac's login shell); elsewhere a shell that is not installed is skipped with its reason.
const script = fileURLToPath(new URL("./install.sh", import.meta.url));
const steps = fileURLToPath(new URL("./install.test.sh", import.meta.url));
const linuxSteps = fileURLToPath(new URL("./install-linux.test.sh", import.meta.url));
for (const shell of ["sh", "bash", "zsh"]) {
  test(`1.12 / 1.15 under ${shell}: the macOS one-liner refuses another system or chip, takes the channel's release, checks its checksum and installs only an app signed by storytree's Apple team that Gatekeeper accepts, writes one marked .zprofile line once, asks nothing once installed but says first how to open the app, and run again updates an older app`, {
    skip: process.platform === "win32" && "platform:posix: the Mac's one-liner runs under a POSIX shell, which Windows CI does not provide",
  }, (t) => {
    const found = spawnSync(shell, ["-c", "exit 0"]);
    if (found.error && process.platform !== "darwin") return t.skip(`platform:darwin: ${shell} unavailable here; macOS CI runs this proof`);
    assert.ifError(found.error);
    const result = spawnSync(shell, [steps, script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /install\.sh PASS/);
  });
  test(`1.13 under ${shell}: on x64 Linux the same one-liner refuses another chip, names the apt command for a missing libfuse2, takes the release's AppImage, installs it with its agent tools and icon under ~/.local/share/storytree-0.3 and a menu entry that starts it, reads its version from the AppImage, and writes the PATH line to ~/.profile`, {
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

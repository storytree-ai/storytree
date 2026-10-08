import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// install.sh is POSIX sh: run by sh under curl | sh, and promised under bash and zsh. On macOS all three are
// required (zsh is the Mac's login shell); elsewhere a shell that is not installed is skipped with its reason.
const script = fileURLToPath(new URL("./install.sh", import.meta.url));
const steps = fileURLToPath(new URL("./install.test.sh", import.meta.url));
for (const shell of ["sh", "bash", "zsh"]) {
  test(`1.12 under ${shell}: the macOS one-liner refuses another system or chip, takes the channel's release and checks its checksum, writes one marked .zprofile line once, and asks to connect agents and for the project folder`, {
    skip: process.platform === "win32" && "platform:win32: the Mac's one-liner runs under a POSIX shell, which Windows CI does not provide",
  }, (t) => {
    const found = spawnSync(shell, ["-c", "exit 0"]);
    if (found.error && process.platform !== "darwin") return t.skip(`platform:darwin: ${shell} unavailable here; macOS CI runs this proof`);
    assert.ifError(found.error);
    const result = spawnSync(shell, [steps, script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /install\.sh PASS/);
  });
}

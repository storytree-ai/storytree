/**
 * Capability 3 · Keeping the host running, contracts 3.1 and 3.2 (ADR-1180 D5). On Linux the one entry point that keeps
 * the service host running is a systemd user unit storytree writes, storytree-host.service, with Restart=always. It runs
 * node itself, not pnpm: a SIGTERM sent to pnpm did not reach the host in a trial (increment_93f522c8ef2d), while one
 * sent to node stops every service and exits 0. node is found as the box's other units find it: the newest under nvm,
 * when the user manager's PATH has none. KillMode=mixed signals the host alone, which stops its own services (D2), and
 * systemd kills only what is left once the stop times out.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** The unit's file name. */
export const UNIT_NAME = "storytree-host.service";

/** The host's command, run from the checkout's root. */
const RUN = "node --import tsx packages/cli/src/bins/storytree.ts services run";

/** The unit that keeps the service host of the storytree checkout `checkout` running. */
export function hostUnit(checkout: string): string {
  return [
    "# storytree's service host (ADR-1180 D5): runs every service this machine's settings turn on. Written by `storytree services install`;",
    "# `storytree services uninstall` removes it. Its log: journalctl --user -u storytree-host.",
    "[Unit]",
    "Description=storytree: the service host",
    "",
    "[Service]",
    `WorkingDirectory=${checkout}`,
    `ExecStart=/bin/bash -c 'command -v node >/dev/null || PATH="$$(ls -d "$$HOME"/.nvm/versions/node/*/bin | sort -V | tail -n1):$$PATH"; exec ${RUN}'`,
    "Restart=always",
    "RestartSec=10",
    "KillMode=mixed",
    "TimeoutStopSec=45",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/** Where the unit goes, and how systemctl --user is run. */
export interface Systemd {
  readonly unitDir: string;
  readonly systemctl: (args: readonly string[]) => void;
}

/** This user's systemd: units under ~/.config/systemd/user, and the real systemctl --user. */
export function userSystemd(): Systemd {
  const config = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return {
    unitDir: path.join(config, "systemd", "user"),
    systemctl: (args) => { execFileSync("systemctl", ["--user", ...args], { stdio: ["ignore", "pipe", "pipe"] }); },
  };
}

/** The storytree checkout the package at `hostDir` is in; refused for a linked git worktree, whose folder goes away. */
export function checkoutOf(hostDir: string): string {
  const checkout = path.resolve(hostDir, "..", "..");
  const git = path.join(checkout, ".git");
  if (existsSync(git) && !statSync(git).isDirectory()) {
    throw new Error(`${checkout} is a git worktree, which goes away when its branch lands: run storytree services install from storytree's own checkout.`);
  }
  return checkout;
}

/** Write the unit for `checkout` (unless it already says the same), enable it and have it running on that text. */
export function installHost(checkout: string, { unitDir, systemctl }: Systemd): string {
  const file = path.join(unitDir, UNIT_NAME);
  const text = hostUnit(checkout);
  const same = existsSync(file) && readFileSync(file, "utf8") === text;
  if (!same) {
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(file, text);
    systemctl(["daemon-reload"]);
  }
  systemctl(["enable", UNIT_NAME]);
  systemctl([same ? "start" : "restart", UNIT_NAME]);
  return same
    ? `${UNIT_NAME} was already installed (${file}); it is enabled and running.`
    : `Wrote ${file}, running the service host from ${checkout}; it is enabled and started. Its log: journalctl --user -u storytree-host.`;
}

/** Stop, disable and remove the unit, if it is installed. */
export function uninstallHost({ unitDir, systemctl }: Systemd): string {
  const file = path.join(unitDir, UNIT_NAME);
  if (!existsSync(file)) return `No ${UNIT_NAME} is installed (${file}).`;
  systemctl(["disable", "--now", UNIT_NAME]);
  rmSync(file);
  systemctl(["daemon-reload"]);
  return `Stopped and removed ${file}: no service host runs here until it is installed again.`;
}

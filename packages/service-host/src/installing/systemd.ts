// Capability 3 · Keeping the host running
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const UNIT_NAME = "storytree-host.service";

const RUN = "node --import tsx packages/cli/src/bins/storytree.ts services run";

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

export interface Systemd {
  readonly unitDir: string;
  readonly systemctl: (args: readonly string[]) => void;
}

export function userSystemd(env: NodeJS.ProcessEnv = process.env, home = homedir()): Systemd {
  const config = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return {
    unitDir: path.join(config, "systemd", "user"),
    systemctl: (args) => { execFileSync("systemctl", ["--user", ...args], { stdio: ["ignore", "pipe", "pipe"] }); },
  };
}

export function checkoutOf(hostDir: string): string {
  const checkout = path.resolve(hostDir, "..", "..");
  const git = path.join(checkout, ".git");
  if (existsSync(git) && !statSync(git).isDirectory()) {
    throw new Error(`${checkout} is a git worktree, which goes away when its branch lands: run storytree services install from storytree's own checkout.`);
  }
  return checkout;
}

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

export function uninstallHost({ unitDir, systemctl }: Systemd): string {
  const file = path.join(unitDir, UNIT_NAME);
  if (!existsSync(file)) return `No ${UNIT_NAME} is installed (${file}).`;
  systemctl(["disable", "--now", UNIT_NAME]);
  rmSync(file);
  systemctl(["daemon-reload"]);
  return `Stopped and removed ${file}: no service host runs here until it is installed again.`;
}

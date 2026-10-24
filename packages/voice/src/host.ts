/**
 * Capability 4 · The box service and its confinement: the door's own repository copy on the Mint box, kept at main by a
 * timer (contract 4.1), the systemd user units that serve it and refresh it (contract 4.2), and the confined system
 * units that replace them, running it as its own box user (contract 4.6).
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

/** The service the door runs as, and the refresh timer's, under the box user's systemd. */
export const SERVICE = "storytree-voice";
export const REFRESH = "storytree-voice-refresh";
const LOCKFILE = "pnpm-lock.yaml";

export interface RefreshSteps {
  /** Runs git in the copy and returns its trimmed output; throws when git fails. */
  readonly git: (...args: string[]) => string;
  /** Reinstalls the copy's packages from its lockfile; throws when the install fails. */
  readonly install: () => void;
  /** Restarts the door's service, so it serves the new HEAD. */
  readonly restart: () => void;
}

export type RefreshOutcome =
  | { readonly moved: false; readonly head: string }
  | { readonly moved: true; readonly from: string; readonly to: string; readonly reinstalled: boolean };

/**
 * Fast-forwards the copy to origin/main. Reinstalls only when the lockfile changed and restarts only when HEAD moved.
 * A failed install puts HEAD back where it was, restarts nothing and throws, so the next run tries the same move again.
 */
export function refresh(steps: RefreshSteps): RefreshOutcome {
  steps.git("fetch", "-q", "origin", "main");
  const from = steps.git("rev-parse", "HEAD");
  if (from === steps.git("rev-parse", "FETCH_HEAD")) return { moved: false, head: from };
  steps.git("merge", "-q", "--ff-only", "FETCH_HEAD");
  // A copy already holding main (ahead of it, as on a branch not yet merged) fast-forwards nowhere.
  const to = steps.git("rev-parse", "HEAD");
  if (to === from) return { moved: false, head: from };
  const changed = steps.git("diff", "--name-only", from, to, "--", LOCKFILE);
  const reinstalled = changed !== "";
  if (reinstalled) {
    try {
      steps.install();
    } catch (error) {
      steps.git("reset", "-q", "--hard", from);
      throw new Error(`the install for ${to.slice(0, 12)} failed, so the copy is back at ${from.slice(0, 12)}: ${(error as Error).message}`);
    }
  }
  steps.restart();
  return { moved: true, from, to, reinstalled };
}

/** The real steps, for the copy at `repoDir`. */
export function boxSteps(repoDir: string): RefreshSteps {
  return {
    git: (...args) => execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
    install: () => {
      execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: repoDir, stdio: "inherit" });
    },
    restart: () => {
      const request = process.env[RESTART_REQUEST_ENV];
      if (request) return restartByRequest(request);
      execFileSync("systemctl", ["--user", "restart", `${SERVICE}.service`], { stdio: "inherit" });
    },
  };
}

/** Set on the confined refresh unit: the file whose change makes systemd restart the door (contract 4.6). */
export const RESTART_REQUEST_ENV = "VOICE_RESTART_REQUEST";

/** The confined door's restart: rewrite the request file its path unit watches; the door's user may restart nothing itself. */
export function restartByRequest(file: string, now: Date = new Date()): void {
  writeFileSync(file, `${now.toISOString()}\n`);
}

export interface HostPaths {
  readonly home: string;
  /** The door's own copy of the repository, never the pool's shared checkout. */
  readonly repoDir: string;
  /** The absolute node binary: a user unit does not see nvm's PATH, and the door spawns the command line with it. */
  readonly node: string;
}

/** The env file holding the secret and the address settings, carried over from the spike unchanged. */
export function secretEnv(home: string): string {
  return path.posix.join(home, ".config", "storytree-voice-spike", "env");
}

/** The door's own env file: only REPO_DIR, which overrides the spike's (the later EnvironmentFile wins). */
export function doorEnv(home: string): string {
  return path.posix.join(home, ".config", "storytree-voice", "env");
}

/** The three unit files, by file name. */
export function units(paths: HostPaths): Record<string, string> {
  const nodeDir = path.posix.dirname(paths.node);
  // tsx from the copy's own install, by file URL, as the door spawns the command line (config.ts).
  const run = (bin: string) => `${paths.node} --import file://${path.posix.join(paths.repoDir, "node_modules", "tsx", "dist", "loader.mjs")} ${path.posix.join(paths.repoDir, "packages", "voice", "src", "bins", bin)}`;
  const service = [
    "[Unit]",
    "Description=storytree voice door: the read-only connector claude.ai calls (127.0.0.1:8787, behind Tailscale Funnel)",
    "StartLimitIntervalSec=120",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${paths.repoDir}`,
    `EnvironmentFile=${secretEnv(paths.home)}`,
    `EnvironmentFile=${doorEnv(paths.home)}`,
    `Environment=PATH=${nodeDir}:/usr/local/bin:/usr/bin:/bin`,
    `ExecStart=${run("voice.ts")}`,
    "Restart=on-failure",
    "RestartSec=5",
    "UMask=0077",
    "NoNewPrivileges=true",
    "MemoryMax=3G",
    "TasksMax=256",
    "CPUQuota=400%",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
  const refreshService = [
    "[Unit]",
    "Description=storytree voice door: fast-forward its copy to main, reinstall on a lockfile change, restart when HEAD moved",
    "",
    "[Service]",
    "Type=oneshot",
    `WorkingDirectory=${paths.repoDir}`,
    `Environment=PATH=${nodeDir}:/usr/local/bin:/usr/bin:/bin`,
    `ExecStart=${run("voice-host.ts")} refresh`,
    "TimeoutStartSec=20min",
    "",
  ].join("\n");
  const timer = [
    "[Unit]",
    "Description=storytree voice door: refresh its copy from main every 15 minutes",
    "",
    "[Timer]",
    "OnCalendar=*:0/15",
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
  return { [`${SERVICE}.service`]: service, [`${REFRESH}.service`]: refreshService, [`${REFRESH}.timer`]: timer };
}

/** The confined door's box user, its state folder (the user's home) and the folders under it (contract 4.6). */
export const VOICE_USER = "storytree-voice";
export const STATE_DIR = "/var/lib/storytree-voice";
export const SYSTEM_PATHS = {
  /** The door's own copy of the repository, owned by its user. */
  repoDir: path.posix.join(STATE_DIR, "repo"),
  /** The door's storytree home: its library address, its password, its machine id and the search models. */
  storytreeHome: path.posix.join(STATE_DIR, "storytree"),
  /** A node of its own: the owner's lives under his home, which the door cannot see. */
  node: "/opt/storytree-voice/node/bin/node",
  /** The secret and the address settings, read by systemd before it drops to the door's user. */
  env: "/etc/storytree-voice/env",
  restartRequest: path.posix.join(STATE_DIR, "restart-request"),
} as const;

const RESTART = "storytree-voice-restart";

/** What every confined unit running as the door's user holds: no home folders, no new privileges, a read-only system. */
const CONFINED = [
  `User=${VOICE_USER}`,
  `Group=${VOICE_USER}`,
  `Environment=HOME=${STATE_DIR}`,
  `Environment=STORYTREE_HOME=${SYSTEM_PATHS.storytreeHome}`,
  `StateDirectory=${path.posix.basename(STATE_DIR)}`,
  "StateDirectoryMode=0750",
  "UMask=0077",
  "NoNewPrivileges=true",
  "ProtectHome=true",
  "ProtectSystem=strict",
  "PrivateTmp=true",
  "PrivateDevices=true",
  "ProtectKernelTunables=true",
  "ProtectKernelModules=true",
  "ProtectControlGroups=true",
  "RestrictSUIDSGID=true",
  "LockPersonality=true",
  "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
  "MemoryMax=3G",
  "TasksMax=256",
];

/** The five system unit files, by file name: the door, its refresh and timer, and the restart its refresh asks for. */
export function systemUnits(): Record<string, string> {
  const { repoDir, node, env, restartRequest } = SYSTEM_PATHS;
  const nodeDir = path.posix.dirname(node);
  const run = (bin: string) => `${node} --import file://${path.posix.join(repoDir, "node_modules", "tsx", "dist", "loader.mjs")} ${path.posix.join(repoDir, "packages", "voice", "src", "bins", bin)}`;
  const service = [
    "[Unit]",
    "Description=storytree voice door: the connector claude.ai calls (127.0.0.1:8787, behind Tailscale Funnel), confined to its own user",
    "After=network-online.target postgresql.service",
    "Wants=network-online.target",
    "StartLimitIntervalSec=120",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${repoDir}`,
    `EnvironmentFile=${env}`,
    `Environment=REPO_DIR=${repoDir}`,
    `Environment=PATH=${nodeDir}:/usr/local/bin:/usr/bin:/bin`,
    ...CONFINED,
    "CPUQuota=400%",
    `ExecStart=${run("voice.ts")}`,
    "Restart=on-failure",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
  const refreshService = [
    "[Unit]",
    "Description=storytree voice door: fast-forward its copy to main, reinstall on a lockfile change, ask for a restart when HEAD moved",
    "",
    "[Service]",
    "Type=oneshot",
    `WorkingDirectory=${repoDir}`,
    `Environment=PATH=${nodeDir}:/usr/local/bin:/usr/bin:/bin`,
    `Environment=${RESTART_REQUEST_ENV}=${restartRequest}`,
    ...CONFINED,
    `ExecStart=${run("voice-host.ts")} refresh`,
    "TimeoutStartSec=20min",
    "",
  ].join("\n");
  const timer = [
    "[Unit]",
    "Description=storytree voice door: refresh its copy from main every 15 minutes",
    "",
    "[Timer]",
    "OnCalendar=*:0/15",
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
  const restartPath = [
    "[Unit]",
    "Description=storytree voice door: restart it when its refresh asks",
    "",
    "[Path]",
    `PathChanged=${restartRequest}`,
    `Unit=${RESTART}.service`,
    "",
    "[Install]",
    "WantedBy=paths.target",
    "",
  ].join("\n");
  const restartService = [
    "[Unit]",
    "Description=storytree voice door: restart the door, as its refresh asked",
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=/usr/bin/systemctl try-restart ${SERVICE}.service`,
    "",
  ].join("\n");
  return {
    [`${SERVICE}.service`]: service,
    [`${REFRESH}.service`]: refreshService,
    [`${REFRESH}.timer`]: timer,
    [`${RESTART}.path`]: restartPath,
    [`${RESTART}.service`]: restartService,
  };
}

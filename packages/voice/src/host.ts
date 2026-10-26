/**
 * Capability 4 · The box service and its confinement: the door's own repository copy on the Mint box, kept at main by a
 * timer (contract 4.1), the systemd user units that serve it and refresh it (contract 4.2), and the confined system
 * units that replace them, running it as its own box user (contract 4.6).
 */
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readPartsOff, readStandIns } from "@storytree/project-and-caller";

/** The service the door runs as, and the refresh timer's, under the box user's systemd. */
export const SERVICE = "storytree-voice";
export const REFRESH = "storytree-voice-refresh";
const LOCKFILE = "pnpm-lock.yaml";

export interface CopySteps {
  /** Runs git in the copy and returns its trimmed output; throws when git fails. */
  readonly git: (...args: string[]) => string;
  /** Reinstalls the copy's packages from its lockfile; throws when the install fails. */
  readonly install: () => void;
}

export interface RefreshSteps extends CopySteps {
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
  const outcome = advance(steps);
  if (outcome.moved) steps.restart();
  return outcome;
}

/** Fast-forwards a copy to origin/main, reinstalling on a lockfile change; a failed install puts HEAD back and throws. */
function advance(steps: CopySteps): RefreshOutcome {
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
  return { moved: true, from, to, reinstalled };
}

/** The door's only part (contract 4.10): the part switch turns it off, or to a factory plugin standing in for it. */
export const VOICE_PART = "voice";

/**
 * The folder the door's code is in, as the part switch in the storytree home `home` names it: the base copy's voice
 * package while voice is on, the factory plugin standing in for it while switched to one, none while it is off.
 */
export function doorCode(repoDir: string, home?: string): string | undefined {
  if (!readPartsOff(home).includes(VOICE_PART)) return path.join(repoDir, "packages", "voice");
  const { folder, plugins } = readStandIns(home);
  const plugin = plugins[VOICE_PART];
  return plugin === undefined ? undefined : path.join(folder, "plugins", plugin);
}

/** Set on the confined refresh unit: the link the door's units run its code through, which the refresh points. */
export const DOOR_LINK_ENV = "VOICE_DOOR_LINK";

export interface DoorSteps {
  /** The base copy, which the door runs storytree's command line from, and its voice package while voice is on. */
  readonly base: CopySteps;
  /** The factory clone, when the door has one. */
  readonly factory?: CopySteps;
  readonly link: string;
  /** Where the door's code is, read from the part switch: none while voice is off. */
  readonly code: () => string | undefined;
  /** Restarts the door, so it serves what moved. */
  readonly restart: () => void;
}

export interface DoorRefreshOutcome {
  readonly base: RefreshOutcome;
  readonly factory?: RefreshOutcome;
  readonly code: string | undefined;
  readonly relinked: boolean;
}

/**
 * Brings both copies to main, points the door's link at the code the switch names (removing it while voice is off),
 * and restarts the door once when either copy moved or the link changed. A copy that fails to move still lets the
 * other's move restart the door, then throws, so the next run tries it again.
 */
export function refreshDoor(steps: DoorSteps): DoorRefreshOutcome {
  const base = advance(steps.base);
  let factory: RefreshOutcome | undefined;
  let failed: unknown;
  try {
    if (steps.factory !== undefined) factory = advance(steps.factory);
  } catch (error) {
    failed = error;
  }
  const code = steps.code();
  const relinked = pointLink(steps.link, code);
  if (base.moved || factory?.moved || relinked) steps.restart();
  if (failed !== undefined) throw failed;
  return { base, ...(factory === undefined ? {} : { factory }), code, relinked };
}

/** Points `link` at `target`, or removes it when there is none; says whether it changed. */
function pointLink(link: string, target: string | undefined): boolean {
  const now = existsSync(link) ? realpathSync(link) : undefined;
  if (now === (target === undefined ? undefined : realpathSync(target))) return false;
  try {
    unlinkSync(link);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // A junction on Windows, where a folder symlink needs a privilege; the type is ignored elsewhere.
  if (target !== undefined) symlinkSync(target, link, "junction");
  return true;
}

/** The real steps, for the copy at `repoDir`. */
export function boxSteps(repoDir: string): RefreshSteps {
  return {
    ...copySteps(repoDir),
    restart: () => {
      const request = process.env[RESTART_REQUEST_ENV];
      if (request) return restartByRequest(request);
      execFileSync("systemctl", ["--user", "restart", `${SERVICE}.service`], { stdio: "inherit" });
    },
  };
}

function copySteps(dir: string): CopySteps {
  return {
    git: (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
    install: () => {
      execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: dir, stdio: "inherit" });
    },
  };
}

/** The real steps of the door's refresh: the base copy at `repoDir`, the factory clone the switch's folder holds, if it is a clone. */
export function boxDoorSteps(repoDir: string, link: string): DoorSteps {
  const { folder } = readStandIns();
  return {
    base: copySteps(repoDir),
    ...(existsSync(path.join(folder, ".git")) ? { factory: copySteps(folder) } : {}),
    link,
    code: () => doorCode(repoDir),
    restart: boxSteps(repoDir).restart,
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
  /** The link the door's units run its code through: the base copy's voice package, or the factory plugin standing in for it. */
  door: path.posix.join(STATE_DIR, "voice"),
} as const;

/**
 * The settings the confined door takes from the spike's env file (contract 4.7): its secret, its port and who may reach
 * it. Anything else, such as the spike's REPO_DIR, is dropped: a value from EnvironmentFile= overrides the unit's own
 * Environment=, so a path under the owner's home would point the door at a folder ProtectHome hides.
 */
export const DOOR_SETTINGS = ["VOICE_TOKEN", "VOICE_SPIKE_TOKEN", "PORT", "ALLOWED_HOSTS", "ALLOWED_CIDRS"] as const;

/** An env file cut to the door's own settings, and the names it dropped, in their order. */
export function doorSettings(text: string): { kept: string; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const name = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];
    if (name === undefined) continue;
    if ((DOOR_SETTINGS as readonly string[]).includes(name)) kept.push(line.trim().replace(/^export\s+/, ""));
    else if (!dropped.includes(name)) dropped.push(name);
  }
  return { kept: kept.length ? `${kept.join("\n")}\n` : "", dropped };
}

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
  const { repoDir, node, env, restartRequest, door } = SYSTEM_PATHS;
  const nodeDir = path.posix.dirname(node);
  // Through the link, with the tsx of the code it points at: the base copy's voice package and a plugin each install their own.
  const run = (bin: string) => `${node} --import file://${path.posix.join(door, "node_modules", "tsx", "dist", "loader.mjs")} ${path.posix.join(door, "src", "bins", bin)}`;
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
    "Description=storytree voice door: fast-forward its copies to main, reinstall on a lockfile change, point its code where the part switch says, ask for a restart when any of that moved",
    "",
    "[Service]",
    "Type=oneshot",
    `WorkingDirectory=${repoDir}`,
    `Environment=PATH=${nodeDir}:/usr/local/bin:/usr/bin:/bin`,
    `Environment=${RESTART_REQUEST_ENV}=${restartRequest}`,
    `Environment=${DOOR_LINK_ENV}=${door}`,
    `Environment=REPO_DIR=${repoDir}`,
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

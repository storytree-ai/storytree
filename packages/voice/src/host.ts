/**
 * Capability 4 · The box service and its confinement: the door's own repository copy on the Mint box, kept at main by a
 * timer (contract 4.1), and the systemd user units that serve it and refresh it (contract 4.2).
 */
import { execFileSync } from "node:child_process";
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
      execFileSync("systemctl", ["--user", "restart", `${SERVICE}.service`], { stdio: "inherit" });
    },
  };
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

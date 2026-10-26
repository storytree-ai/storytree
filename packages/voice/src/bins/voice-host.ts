/**
 * Capability 4 · The box service and its confinement: install the door on the Mint box from its own repository copy
 * (contract 4.2), and the refresh its timer runs (contract 4.1).
 *
 *   voice-host install [--dry-run] [--repo-dir <dir>]   the copy (never the pool's checkout), its env file and the three
 *                                                        user units; enables the timer
 *   voice-host refresh                                   what the timer runs, in the copy it lives in; on the confined
 *                                                        unit, which names the door's link, both copies and the link
 *   voice-host part voice on|off|plugin <plugin>         switch the door's only part (contract 4.10), in the storytree
 *                                                        home it runs with: to a factory plugin standing in for it, or back
 *   voice-host system-units [--dry-run] [--dir <dir>]    the confined system units (contract 4.6), into /etc/systemd/system
 *                                                        by default; box/confine.sh runs it as root and enables them
 *   voice-host door-env --from <file> --to <file> [--dry-run]
 *                                                        the confined door's env file: only the door's own settings from
 *                                                        the spike's (contract 4.7), written 0600; box/confine.sh runs it
 *
 * install never starts the door: the cut-over from the spike is its own step, printed at the end with its rollback.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { switchPart } from "@storytree/project-and-caller";
import { DOOR_LINK_ENV, REFRESH, SERVICE, VOICE_PART, boxDoorSteps, boxSteps, doorEnv, doorSettings, refresh, refreshDoor, secretEnv, systemUnits, units } from "../host.js";

export interface HostIo {
  readonly home: string;
  readonly node: string;
  readonly say: (line: string) => void;
  /** Runs a command, inheriting output; throws when it fails. */
  readonly run: (command: string, args: readonly string[], cwd?: string) => void;
  /** The repository this script runs from, whose origin the copy is cloned from. */
  readonly sourceRepo: string;
  /** The storytree home whose part switch `part` sets; STORYTREE_HOME's, or the default, when not given. */
  readonly storytreeHome?: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

const boxIo: HostIo = {
  home: os.homedir(),
  node: process.execPath,
  say: (line) => process.stdout.write(`${line}\n`),
  run: (command, args, cwd) => {
    execFileSync(command, args, { cwd, stdio: "inherit" });
  },
  sourceRepo: path.resolve(here, "..", "..", "..", ".."),
};

/** Exit code 0 on success; a usage or install failure is one line and 1. */
export function main(argv: readonly string[], io: HostIo = boxIo): number {
  const [command, ...rest] = argv;
  if (command === "refresh" && process.env[DOOR_LINK_ENV]) {
    // The confined unit: the base copy is REPO_DIR, wherever this code is (the link may point into the factory).
    const repoDir = process.env.REPO_DIR || io.sourceRepo;
    const outcome = refreshDoor(boxDoorSteps(repoDir, process.env[DOOR_LINK_ENV]!));
    const moved = (name: string, one: { moved: boolean } & Partial<{ from: string; to: string }>) => (one.moved ? [`${name} ${one.from!.slice(0, 12)} -> ${one.to!.slice(0, 12)}`] : []);
    const said = [...moved("base", outcome.base), ...(outcome.factory ? moved("factory", outcome.factory) : []), ...(outcome.relinked ? [`door's code now ${outcome.code ?? "none (voice is off)"}`] : [])];
    io.say(`${new Date().toISOString()} ${said.length ? `${said.join(", ")}; restarted ${SERVICE}` : "nothing to do"}`);
    return 0;
  }
  if (command === "part") {
    const [part, state, plugin] = rest;
    if (part !== VOICE_PART || state === undefined) {
      io.say(`there is no part called ${part ?? "(none)"} here: the door's only part is ${VOICE_PART} (usage: voice-host part ${VOICE_PART} on|off|plugin <plugin>)`);
      return 1;
    }
    try {
      switchPart(part, state, [VOICE_PART], io.storytreeHome, plugin, { through: "command line" });
    } catch (error) {
      io.say((error as Error).message);
      return 1;
    }
    io.say(state === "plugin" ? `voice is switched to the factory plugin ${plugin}` : `voice is switched ${state}`);
    io.say("the door takes it at its next refresh (within 15 minutes), or now: sudo systemctl start storytree-voice-refresh");
    return 0;
  }
  if (command === "refresh") {
    const outcome = refresh(boxSteps(io.sourceRepo));
    io.say(outcome.moved ? `${new Date().toISOString()} moved ${outcome.from.slice(0, 12)} -> ${outcome.to.slice(0, 12)}${outcome.reinstalled ? ", reinstalled" : ""}, restarted ${SERVICE}` : `${new Date().toISOString()} at main ${outcome.head.slice(0, 12)}, nothing to do`);
    return 0;
  }
  const dryRun = rest.includes("--dry-run");
  if (command === "system-units") {
    const at = rest.indexOf("--dir");
    const dir = at >= 0 && rest[at + 1] ? path.resolve(rest[at + 1]!) : "/etc/systemd/system";
    for (const [file, text] of Object.entries(systemUnits())) {
      io.say(`${dryRun ? "would write" : "write"} ${path.join(dir, file)}`);
      if (!dryRun) writeFileSync(path.join(dir, file), text, { mode: 0o644 });
    }
    return 0;
  }
  if (command === "door-env") {
    const value = (flag: string) => {
      const at = rest.indexOf(flag);
      return at >= 0 && rest[at + 1] ? path.resolve(rest[at + 1]!) : undefined;
    };
    const [from, to] = [value("--from"), value("--to")];
    if (from === undefined || to === undefined) {
      io.say("usage: voice-host door-env --from <file> --to <file> [--dry-run]");
      return 1;
    }
    if (!existsSync(from)) {
      io.say(`${from} is missing: it holds the door's secret and address settings`);
      return 1;
    }
    const { kept, dropped } = doorSettings(readFileSync(from, "utf8"));
    const names = kept.split("\n").filter(Boolean).map((line) => line.slice(0, line.indexOf("=")));
    io.say(`${dryRun ? "would write" : "write"} ${to} with ${names.join(", ") || "nothing"}${dropped.length ? `; dropped ${dropped.join(", ")} (the unit sets its own)` : ""}`);
    if (!dryRun) {
      writeFileSync(to, kept, { mode: 0o600 });
      chmodSync(to, 0o600);
    }
    return 0;
  }
  if (command !== "install") {
    io.say("usage: voice-host install [--dry-run] [--repo-dir <dir>] | voice-host refresh | voice-host part voice on|off|plugin <plugin> | voice-host system-units [--dry-run] [--dir <dir>] | voice-host door-env --from <file> --to <file> [--dry-run]");
    return 1;
  }
  const at = rest.indexOf("--repo-dir");
  const repoDir = at >= 0 && rest[at + 1] ? path.resolve(rest[at + 1]!) : path.join(io.home, "storytree-voice-door");
  const pool = poolCheckout(io);
  if (pool !== undefined && same(repoDir, pool)) {
    io.say(`the door needs its own copy, not the pool's checkout ${pool}: the pool fast-forwards and reinstalls that one under every lane`);
    return 1;
  }
  const secret = secretEnv(io.home);
  if (!existsSync(secret)) {
    io.say(`${secret} is missing: it holds the door's secret and address settings (the spike's README, step 1)`);
    return 1;
  }
  const act = (line: string, work: () => void) => {
    io.say(`${dryRun ? "would " : ""}${line}`);
    if (!dryRun) work();
  };

  if (!existsSync(repoDir)) {
    const origin = execFileSync("git", ["-C", io.sourceRepo, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
    act(`clone ${origin} (main) into ${repoDir}`, () => io.run("git", ["clone", "-q", "--branch", "main", origin, repoDir]));
    act(`pnpm install --frozen-lockfile in ${repoDir}`, () => io.run("pnpm", ["install", "--frozen-lockfile"], repoDir));
  } else {
    io.say(`${repoDir} is there; the timer keeps it at main`);
  }
  const resolved = existsSync(repoDir) ? realpathSync(repoDir) : repoDir;
  const envFile = doorEnv(io.home);
  act(`write ${envFile} (REPO_DIR only; the secret stays in ${secret})`, () => {
    mkdirSync(path.dirname(envFile), { recursive: true, mode: 0o700 });
    writeFileSync(envFile, `REPO_DIR=${resolved}\n`, { mode: 0o600 });
  });
  const unitDir = path.join(io.home, ".config", "systemd", "user");
  for (const [file, text] of Object.entries(units({ home: io.home, repoDir: resolved, node: io.node }))) {
    act(`write ${path.join(unitDir, file)}`, () => {
      mkdirSync(unitDir, { recursive: true });
      writeFileSync(path.join(unitDir, file), text);
    });
  }
  act(`systemctl --user daemon-reload && systemctl --user enable --now ${REFRESH}.timer`, () => {
    io.run("systemctl", ["--user", "daemon-reload"]);
    io.run("systemctl", ["--user", "enable", "--now", `${REFRESH}.timer`]);
  });
  io.say(`cut over from the spike: systemctl --user disable --now storytree-voice-spike && systemctl --user enable --now ${SERVICE}`);
  io.say(`roll back: systemctl --user disable --now ${SERVICE} && systemctl --user enable --now storytree-voice-spike`);
  return 0;
}

/** The pool's shared checkout, as the repository's agent-pool.json names it (~ is the home folder), if it names one. */
function poolCheckout(io: HostIo): string | undefined {
  try {
    const checkout = (JSON.parse(readFileSync(path.join(io.sourceRepo, "agent-pool.json"), "utf8")) as { checkout?: unknown }).checkout;
    return typeof checkout === "string" ? path.resolve(checkout.replace(/^~(?=$|[\\/])/, io.home)) : undefined;
  } catch {
    return undefined;
  }
}

function same(a: string, b: string): boolean {
  const real = (p: string) => (existsSync(p) ? realpathSync(p) : path.resolve(p));
  return real(a) === real(b);
}

function isEntry(): boolean {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`voice-host: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

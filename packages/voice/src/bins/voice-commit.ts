/**
 * Capability 5 · Drafted writes with read-back and undo (contract 5.5): one tick of the box's committer, run as a slow
 * fallback by the owner's user timer (box/voice-commit.timer) beside the listener that ticks on every confirm
 * (voice-listen.ts). It reaches the door's database as the owner's account, over the local socket unless VOICE_DRAFTS_URL
 * says otherwise.
 */
import os from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commitDue, type Committer } from "../commit.js";
import { Drafts } from "../drafts.js";

function argv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((part) => typeof part === "string" && part !== "")) {
    throw new Error("VOICE_RUN_LANE must be a non-empty JSON array of strings");
  }
  return parsed as string[];
}

/** The committer `env` describes: the owner's checkout, run-lane.sh, and the folders under ~/storytree-lanes. */
export function committerFrom(env: NodeJS.ProcessEnv, log: (line: string) => void): Committer {
  const home = env.HOME || os.homedir();
  const lanes = path.join(home, "storytree-lanes");
  return {
    repoDir: env.REPO_DIR || path.join(home, "code", "storytree03"),
    runLane: argv(env.VOICE_RUN_LANE, ["bash", path.join(lanes, "run-lane.sh")]),
    runsDir: env.VOICE_RUNS_DIR || path.join(lanes, "voice-runs"),
    laptopLog: env.VOICE_LAPTOP_LOG || path.join(lanes, "overnight-log.md"),
    env,
    log,
  };
}

/** The door's database as the owner's account. */
export const draftsUrl = (env: NodeJS.ProcessEnv) => env.VOICE_DRAFTS_URL || "postgresql:///storytree-voice?host=/var/run/postgresql";

export const stdoutLog = (line: string) => void process.stdout.write(`${line}\n`);

/** One tick from `env`: carries out what is due, then closes its connection. */
export async function main(env: NodeJS.ProcessEnv, log: (line: string) => void = stdoutLog): Promise<void> {
  const drafts = Drafts.open(draftsUrl(env));
  try {
    await commitDue(drafts, committerFrom(env, log));
  } finally {
    await drafts.close();
  }
}

/** Whether the module at `url` is the script node was started with. */
export function isEntry(url: string): boolean {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

if (isEntry(import.meta.url)) await main(process.env);

/**
 * Capability 5 · Drafted writes with read-back and undo (contract 5.5): one tick of the box's committer, run every minute by
 * the owner's user timer (box/voice-commit.timer). It reaches the door's database as the owner's account, over the local
 * socket unless VOICE_DRAFTS_URL says otherwise.
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

/** One tick from `env`: carries out what is due, then closes its connection. */
export async function main(env: NodeJS.ProcessEnv, log: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Promise<void> {
  const home = env.HOME || os.homedir();
  const lanes = path.join(home, "storytree-lanes");
  const repoDir = env.REPO_DIR || path.join(home, "code", "storytree03");
  const committer: Committer = {
    repoDir,
    runLane: argv(env.VOICE_RUN_LANE, ["bash", path.join(lanes, "run-lane.sh")]),
    runsDir: env.VOICE_RUNS_DIR || path.join(lanes, "voice-runs"),
    laptopLog: env.VOICE_LAPTOP_LOG || path.join(lanes, "overnight-log.md"),
    env,
    log,
  };
  const drafts = Drafts.open(env.VOICE_DRAFTS_URL || "postgresql:///storytree-voice?host=/var/run/postgresql");
  try {
    await commitDue(drafts, committer);
  } finally {
    await drafts.close();
  }
}

function isEntry(): boolean {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) await main(process.env);

/**
 * Capability 5 · Drafted writes with read-back and undo (contracts 5.5, 5.6, 5.8, 5.12, 5.13): the box's committer. Ticked by the
 * owner's account's listener on every confirm (listen.ts), and by a slow fallback timer (box/voice-commit.timer), it
 * carries out each due draft once: a session manager
 * run is started through run-lane.sh, its brief carrying every note not yet swept, which it marks swept by that run; a run
 * that fails to start ends as failed, its reply saying so, and leaves its notes for the next run. On the box each run is its
 * own systemd unit (contract 5.13), so it outlives the tick that launched it, and one whose unit stopped with no end mark is
 * recorded ended. It also marks heard in the library each FYI the owner marked heard by voice (contract 5.15). The
 * confined door can do none of these (it may not mark a note swept or reach ~/storytree-lanes), which is why this is separate.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SESSION_ENV, WATCHED_HARNESSES, type WatchedHarness } from "@storytree/project-and-caller/caller";
import { RUN_HOURS, managerBrief, type Draft, type Drafts } from "./drafts.js";

export interface Committer {
  /** The owner's checkout, where run-lane.sh runs. */
  readonly repoDir: string;
  /** run-lane.sh as an argument array, before its brief, log and error files. */
  readonly runLane: readonly string[];
  /** The storytree command line as an argument array, run in the checkout as the owner's account. */
  readonly storytree: readonly string[];
  /** Where each run's brief, logs, reply and end mark go. */
  readonly runsDir: string;
  readonly env: NodeJS.ProcessEnv;
  readonly log: (line: string) => void;
  readonly now?: () => Date;
  /** When set, each run starts as its own unit, voice-run-<id>, rather than as a detached child of the tick. */
  readonly units?: RunUnits;
}

/**
 * systemd-run and systemctl, each as an argument array before its own arguments. A child of a tick dies with the tick's
 * unit when it exits (systemd's KillMode=control-group): the 15-minute timer's tick killed draft 11's run that way on
 * 2026-10-25, leaving it read as started with nothing running.
 */
export interface RunUnits {
  readonly start: readonly string[];
  readonly ask: readonly string[];
}

/** What systemd sets for the tick's own unit: a run's unit gets its own. */
const SYSTEMD_OWN = new Set(["INVOCATION_ID", "JOURNAL_STREAM", "SYSTEMD_EXEC_PID", "MANAGERPID", "NOTIFY_SOCKET", "WATCHDOG_PID", "WATCHDOG_USEC", "LISTEN_PID", "LISTEN_FDS", "LISTEN_FDNAMES"]);

export const DROPPED = "dropped: voice writes were locked";
const REPLY_CHARS = 4000;
const FAILURE_CHARS = 300;

/** Every harness's session variable: a run the committer starts never records as the timer's own session. */
const SESSION_NAMES = [SESSION_ENV, ...(WATCHED_HARNESSES as readonly WatchedHarness[]).flatMap((harness) => (harness.shellSession ? [harness.shellSession] : []))];

/** The files of one voice-started run. */
export function runFiles(runsDir: string, id: number) {
  const at = (suffix: string) => path.join(runsDir, `voice-run-${id}.${suffix}`);
  return { brief: at("brief.md"), log: at("log"), err: at("err"), reply: at("reply.md"), ended: at("ended"), unit: at("unit") };
}

function childEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  const scrubbed = new Set(SESSION_NAMES.map((name) => name.toUpperCase()));
  for (const [name, value] of Object.entries(env)) if (value !== undefined && !scrubbed.has(name.toUpperCase())) out[name] = value;
  return out;
}

const flat = (text: string, max: number) => {
  const line = text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
};

/** Run argv to its end, for its exit code and output. */
function ran(argv: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const [command = "", ...args] = argv;
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => void (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => void (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Whether the run's unit still runs: false once systemd reads it inactive or failed (a collected unit reads inactive), true
 * while it runs, and undefined when systemd cannot be asked, which decides nothing.
 */
async function unitRuns(units: RunUnits, unit: string): Promise<boolean | undefined> {
  try {
    const state = (await ran([...units.ask, "is-active", `${unit}.service`])).stdout.trim();
    if (state === "inactive" || state === "failed") return false;
    return /^(active|activating|deactivating|reloading|refreshing)$/.test(state) ? true : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Start the run detached through run-lane.sh, its brief carrying every unswept note, which it marks swept by this run once it
 * has started; a shell around it marks its end, so a later tick can read its reply.
 */
async function launch(draft: Draft, drafts: Drafts, committer: Committer): Promise<string> {
  mkdirSync(committer.runsDir, { recursive: true });
  const files = runFiles(committer.runsDir, draft.id);
  return drafts.sweep(draft.id, async (notes) => {
    writeFileSync(files.brief, `${managerBrief(draft.words, draft.session, notes, draft.id)}\n\nReply file: ${files.reply}\n`);
    const run = ["sh", "-c", '"$@"; : > "$VOICE_RUN_ENDED"', "voice-run", ...committer.runLane, files.brief, files.log, files.err];
    const env = { ...childEnv(committer.env), VOICE_RUN_ENDED: files.ended };
    if (committer.units) {
      // Its own unit, given each variable by name only, so no value is written into a command line systemd shows.
      const unit = `voice-run-${draft.id}`;
      const names = Object.keys(env).filter((name) => !SYSTEMD_OWN.has(name) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
      writeFileSync(files.unit, `${unit}\n`);
      const started = await ran(
        [...committer.units.start, `--unit=${unit}`, "--collect", "--quiet", `--working-directory=${committer.repoDir}`, ...names.map((name) => `--setenv=${name}`), ...run],
        { cwd: committer.repoDir, env },
      );
      if (started.code !== 0) throw new Error(started.stderr.trim() || `systemd-run exited ${started.code}`);
      return "started";
    }
    const [command = "", ...args] = run;
    const child = spawn(command, args, { cwd: committer.repoDir, env, detached: true, stdio: "ignore" });
    // Its notes stay swept only once it has started: a spawn that fails (a missing checkout) rejects here.
    await once(child, "spawn");
    child.unref();
    return "started";
  });
}

/**
 * Mark heard in the library, one at a time, each FYI he marked heard by voice that is not yet carried; one storytree refuses
 * stays for the next tick. Heard marks are not voice writes a lock stops: mark_heard works while locked too.
 */
async function carryFyis(drafts: Drafts, committer: Committer): Promise<void> {
  for (const fyi of await drafts.heardFyis()) {
    let said: { code: number | null; stdout: string; stderr: string };
    try {
      said = await ran([...committer.storytree, "fyi", "heard", fyi], { cwd: committer.repoDir, env: childEnv(committer.env) });
    } catch (error) {
      said = { code: null, stdout: "", stderr: (error as Error | undefined)?.message ?? String(error) };
    }
    if (said.code !== 0) {
      committer.log(`${fyi} not yet marked heard in the library: ${flat(said.stderr || said.stdout, FAILURE_CHARS) || `exit ${said.code}`}`);
      continue;
    }
    await drafts.pool.query("UPDATE voice_fyi_heard SET carried_at = now() WHERE fyi = $1", [fyi]);
    committer.log(`${fyi} marked heard in the library`);
  }
}

/** One tick: drop what a lock stopped, carry out each due draft once, record the replies of runs that ended, and carry FYI heard marks. */
export async function commitDue(drafts: Drafts, committer: Committer): Promise<void> {
  const now = committer.now ?? (() => new Date());
  const pool = drafts.pool;
  // A mark not carried waits for the next tick; it never stops the drafts below.
  await carryFyis(drafts, committer).catch((error: unknown) => committer.log(`FYI heard marks not carried: ${flat((error as Error | undefined)?.message ?? String(error), FAILURE_CHARS)}`));
  const lock = await drafts.locked();
  if (lock !== null) {
    const dropped = await pool.query(
      "UPDATE voice_draft SET cancelled_at = now(), outcome = $1 WHERE kind = 'manager_run' AND confirmed_at IS NOT NULL AND committed_at IS NULL AND cancelled_at IS NULL RETURNING id",
      [DROPPED],
    );
    for (const { id } of dropped.rows) committer.log(`draft ${id} ${DROPPED}`);
  } else {
    const due = await pool.query<Draft>(
      "SELECT * FROM voice_draft WHERE kind = 'manager_run' AND confirmed_at IS NOT NULL AND committed_at IS NULL AND cancelled_at IS NULL AND commit_at <= now() ORDER BY id",
    );
    for (const waiting of due.rows) {
      const running = await pool.query(
        `SELECT id FROM voice_draft WHERE kind = 'manager_run' AND committed_at IS NOT NULL AND run_ended_at IS NULL AND id <> $1
           AND committed_at > now() - interval '${RUN_HOURS} hours'`,
        [waiting.id],
      );
      if (running.rows.length > 0) {
        committer.log(`draft ${waiting.id} held: run ${running.rows[0].id} still holds the box`);
        continue;
      }
      // The claim: only the tick whose update sets committed_at carries the draft out, so each is carried out once.
      let claimed: Draft | undefined;
      try {
        claimed = (await pool.query<Draft>(
          "UPDATE voice_draft SET committed_at = now() WHERE id = $1 AND committed_at IS NULL AND cancelled_at IS NULL RETURNING *",
          [waiting.id],
        )).rows[0];
      } catch (error) {
        if ((error as { code?: string }).code !== "P0001") throw error;
        committer.log(`draft ${waiting.id} not carried out: ${(error as Error).message}`);
        continue;
      }
      if (claimed === undefined) continue;
      let outcome: string;
      try {
        outcome = await launch(claimed, drafts, committer);
      } catch (error) {
        // Claimed but never started: the claim cannot be undone, so the draft ends here as failed, its reply saying so,
        // rather than staying committed with no outcome, holding the box and never read back (seen 2026-10-25, draft 4).
        const why = flat((error as Error | undefined)?.message ?? String(error), FAILURE_CHARS);
        await pool.query("UPDATE voice_draft SET outcome = $2, run_ended_at = now(), reply = $3 WHERE id = $1", [
          claimed.id,
          `failed: ${why}`,
          `The run you asked for never started: ${why}`,
        ]);
        committer.log(`draft ${claimed.id} ${claimed.kind}: failed to start: ${why}`);
        continue;
      }
      await pool.query("UPDATE voice_draft SET outcome = $2 WHERE id = $1", [claimed.id, outcome]);
      committer.log(`draft ${claimed.id} ${claimed.kind}: ${outcome}`);
    }
  }

  const started = await pool.query<Draft>("SELECT * FROM voice_draft WHERE kind = 'manager_run' AND committed_at IS NOT NULL AND run_ended_at IS NULL AND outcome = 'started'");
  for (const runDraft of started.rows) {
    const files = runFiles(committer.runsDir, runDraft.id);
    const reply = existsSync(files.reply) ? flat(readFileSync(files.reply, "utf8"), REPLY_CHARS) || null : null;
    if (existsSync(files.ended)) {
      await pool.query("UPDATE voice_draft SET run_ended_at = now(), reply = $2, outcome = $3 WHERE id = $1", [runDraft.id, reply, reply ? "ended" : "ended without a reply"]);
      committer.log(`draft ${runDraft.id} run ended${reply ? "" : " without a reply"}`);
    } else if (committer.units && existsSync(files.unit) && (await unitRuns(committer.units, readFileSync(files.unit, "utf8").trim())) === false && !existsSync(files.ended)) {
      // Its unit stopped before the run marked its end: it was killed or crashed, so it ends here rather than hold the box.
      const outcome = reply ? "ended" : "ended without a reply: the run stopped before it finished";
      await pool.query("UPDATE voice_draft SET run_ended_at = now(), reply = $2, outcome = $3 WHERE id = $1", [runDraft.id, reply, outcome]);
      committer.log(`draft ${runDraft.id} run: its unit stopped with no end mark`);
    } else if (now().getTime() - new Date(runDraft.committed_at!).getTime() > RUN_HOURS * 3_600_000) {
      await pool.query("UPDATE voice_draft SET run_ended_at = now(), reply = $2, outcome = $3 WHERE id = $1", [runDraft.id, reply, `no end seen within ${RUN_HOURS} hours`]);
      committer.log(`draft ${runDraft.id} run: no end seen within ${RUN_HOURS} hours`);
    }
  }
}

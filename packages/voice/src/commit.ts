/**
 * Capability 5 · Drafted writes with read-back and undo (contracts 5.5, 5.6, 5.8): the box's committer. Ticked by the
 * owner's account's listener on every confirm (listen.ts), and by a slow fallback timer (box/voice-commit.timer), it
 * carries out each due draft once: a session manager
 * run is started through run-lane.sh, its brief carrying every note not yet swept, which it marks swept by that run. The
 * confined door can do neither (it may not mark a note swept or reach ~/storytree-lanes), which is why this is separate.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SESSION_ENV, WATCHED_HARNESSES, type WatchedHarness } from "@storytree/project-and-caller/caller";
import { RUN_HOURS, managerBrief, type Draft, type Drafts } from "./drafts.js";

export interface Committer {
  /** The owner's checkout, where run-lane.sh runs. */
  readonly repoDir: string;
  /** run-lane.sh as an argument array, before its brief, log and error files. */
  readonly runLane: readonly string[];
  /** Where each run's brief, logs, reply and end mark go. */
  readonly runsDir: string;
  /** The laptop's scheduled session manager's log, written at the end of each of its runs. */
  readonly laptopLog: string;
  readonly env: NodeJS.ProcessEnv;
  readonly log: (line: string) => void;
  readonly now?: () => Date;
}

export const DROPPED = "dropped: voice writes were locked";
const REPLY_CHARS = 4000;

/** Every harness's session variable: a run the committer starts never records as the timer's own session. */
const SESSION_NAMES = [SESSION_ENV, ...(WATCHED_HARNESSES as readonly WatchedHarness[]).flatMap((harness) => (harness.shellSession ? [harness.shellSession] : []))];

/**
 * Whether the laptop's scheduled session manager run may be running: it starts at quarter past each odd hour, Sydney time,
 * so its window opens at ten past and lasts until its log is written, at most until the hour ends (50 minutes).
 */
export function laptopWindowOpen(now: Date, logWritten: Date | null): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (hour % 2 === 0 || minute < 10) return false;
  const opened = new Date(now.getTime() - ((minute - 10) * 60 + now.getUTCSeconds()) * 1000 - now.getUTCMilliseconds());
  return logWritten === null || logWritten < opened;
}

/** The files of one voice-started run. */
export function runFiles(runsDir: string, id: number) {
  const at = (suffix: string) => path.join(runsDir, `voice-run-${id}.${suffix}`);
  return { brief: at("brief.md"), log: at("log"), err: at("err"), reply: at("reply.md"), ended: at("ended") };
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

/**
 * Start the run detached through run-lane.sh, its brief carrying every unswept note, which it marks swept by this run; a
 * shell around it marks its end, so a later tick can read its reply.
 */
async function launch(draft: Draft, drafts: Drafts, committer: Committer): Promise<string> {
  mkdirSync(committer.runsDir, { recursive: true });
  const files = runFiles(committer.runsDir, draft.id);
  const notes = await drafts.sweep(draft.id);
  writeFileSync(files.brief, `${managerBrief(draft.words, draft.session, notes)}\n\nReply file: ${files.reply}\n`);
  const child = spawn("sh", ["-c", '"$@"; : > "$VOICE_RUN_ENDED"', "voice-run", ...committer.runLane, files.brief, files.log, files.err], {
    cwd: committer.repoDir,
    env: { ...childEnv(committer.env), VOICE_RUN_ENDED: files.ended },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return "started";
}

/** One tick: drop what a lock stopped, carry out each due draft once, and record the replies of runs that ended. */
export async function commitDue(drafts: Drafts, committer: Committer): Promise<void> {
  const now = committer.now ?? (() => new Date());
  const pool = drafts.pool;
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
      const written = existsSync(committer.laptopLog) ? statSync(committer.laptopLog).mtime : null;
      if (laptopWindowOpen(now(), written)) {
        committer.log(`draft ${waiting.id} held: the laptop's session manager run may be running`);
        continue;
      }
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
      const outcome = await launch(claimed, drafts, committer);
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
    } else if (now().getTime() - new Date(runDraft.committed_at!).getTime() > RUN_HOURS * 3_600_000) {
      await pool.query("UPDATE voice_draft SET run_ended_at = now(), reply = $2, outcome = $3 WHERE id = $1", [runDraft.id, reply, `no end seen within ${RUN_HOURS} hours`]);
      committer.log(`draft ${runDraft.id} run: no end seen within ${RUN_HOURS} hours`);
    }
  }
}

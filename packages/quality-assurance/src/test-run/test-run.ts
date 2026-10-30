/**
 * Capability 8 · Verified test run (decision_1c5b459634a7): the run_tests tool runs a project's test command itself and
 * records the run against the folder's files and the command, so the next role in a user's build loop (the orchestrator
 * after the green builder, then the reviewer) reads that run instead of running a slow suite again (friction_1ce9ab89c00e).
 *
 * The files are fingerprinted as the Git tree they would commit as: the index copied to a scratch one, every tracked and
 * new file added to it (Git's ignored files left out), and the tree written. Committing them leaves that tree the same,
 * and any edit changes it, so a run made before the diff gate is still the run of the commit that follows. Runs are kept
 * one JSON line each in storytree/test-runs.jsonl in the clone's Git directory, as 0.3's own red runs are, so nothing is
 * written into the user's tree. A run is trusted because storytree ran it; what an agent says stays the report tool's.
 */
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

/** How many of a run's last output lines its record keeps. */
const TAIL = 20;

/** One run, as test-runs.jsonl keeps it. */
export interface VerifiedRun {
  readonly at: string;
  /** The commit the folder was at, for reading; the run is matched by its tree. */
  readonly head: string;
  readonly tree: string;
  readonly command: string;
  readonly code: number;
  readonly seconds: number;
  readonly tail: readonly string[];
  /** The session that ran it. */
  readonly by: string;
}

/** What run_tests has for one call, as far as it needs it. */
interface ToolCall {
  readonly folder: string;
  readonly caller: { readonly session: string };
}

interface ToolAnswer {
  readonly text: string;
  readonly data?: Record<string, unknown>;
}

type DefineTool = <S extends z.ZodObject>(name: string, description: string, input: S, act: (args: z.output<S>, call: ToolCall) => Promise<ToolAnswer>, options?: { readonly consumers?: readonly ("agent" | "user")[] }) => void;

/** This capability's contribution to the MCP server's one tool server. */
export interface ToolExtension {
  readonly registerTools?: (define: DefineTool) => void;
}

function git(folder: string, args: readonly string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, { cwd: folder, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, ...(env === undefined ? {} : { env }) }).trim();
}

/** The folder's Git directory shared by its worktrees, or a refusal saying why there is none. */
function commonDir(folder: string): string {
  try {
    return git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  } catch {
    throw new Error(`${folder} is not in a Git repository: run_tests records a run against the files Git sees, so it needs one. Nothing was run.`);
  }
}

/** The tree the folder's tracked and new files would commit as, written through a scratch index so the real one is untouched. */
function filesTree(folder: string): string {
  const scratch = mkdtempSync(path.join(tmpdir(), "storytree-index-"));
  try {
    const index = path.join(scratch, "index");
    const real = git(folder, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
    if (existsSync(real)) {
      copyFileSync(real, index);
      // The copy keeps the index's time: Git re-reads a file changed within the index's own second only while the
      // index file is no newer than it, and a fresh copy's time would hide a same-sized edit made in that second.
      const { atime, mtime } = statSync(real);
      utimesSync(index, atime, mtime);
    }
    const env = { ...process.env, GIT_INDEX_FILE: index };
    git(folder, ["add", "-A", ":/"], env);
    return git(folder, ["write-tree"], env);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function readRuns(file: string): VerifiedRun[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as VerifiedRun];
    } catch {
      return [];
    }
  });
}

/** Run `command` through the shell in `folder`, with its output's last lines. */
function runCommand(command: string, folder: string): Promise<{ code: number; seconds: number; tail: string[] }> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: folder, shell: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-64_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const tail = output.split(/\r?\n/).filter((line) => line.trim() !== "").slice(-TAIL);
      resolve({ code: code ?? (signal === null ? 1 : 128), seconds: Math.round((performance.now() - started) / 100) / 10, tail });
    });
  });
}

function said(run: VerifiedRun): string {
  return run.code === 0 ? "passed" : `failed (exit code ${run.code})`;
}

/**
 * Run `command` in `folder` and record it, or, unless `fresh`, answer with the run already recorded for the same command
 * at the same files (contracts 8.1, 8.2). Refused outside a Git repository, with nothing run (8.3).
 */
export async function verifiedRun(folder: string, command: string, by: string, fresh: boolean): Promise<{ run: VerifiedRun; reused: boolean }> {
  const file = path.join(commonDir(folder), "storytree", "test-runs.jsonl");
  const tree = filesTree(folder);
  const recorded = fresh ? undefined : readRuns(file).findLast((run) => run.tree === tree && run.command === command);
  if (recorded !== undefined) return { run: recorded, reused: true };
  let head = "";
  try {
    head = git(folder, ["rev-parse", "HEAD"]);
  } catch {
    // a repository with no commit yet: the run is kept with no head
  }
  const at = new Date().toISOString();
  const result = await runCommand(command, folder);
  const run: VerifiedRun = { at, head, tree, command, ...result, by };
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(run)}\n`);
  return { run, reused: false };
}

function runText({ run, reused }: { run: VerifiedRun; reused: boolean }): string {
  const head = reused
    ? `${run.command}: ${said(run)}, verified at these files by ${run.by} at ${run.at} in ${run.seconds}s; not re-run (fresh runs it again).`
    : `${run.command}: ${said(run)} in ${run.seconds}s, recorded against these files for the next role to read.`;
  return [head, ...run.tail.map((line) => `  ${line}`)].join("\n");
}

/** The tool this capability serves on the MCP server: an agent session's, a builder's, orchestrator's or reviewer's. */
export function testRunTools(): ToolExtension {
  return {
    registerTools(define) {
      define("run_tests", "Run the project's test command in your folder and record the run against its files; called again with the same command at the same files, committed or not, it answers with that verified run instead of running the suite again.", z.object({
        command: z.string().min(1).describe("The project's test command, exactly as each role gives it"),
        fresh: z.boolean().optional().describe("Run it even if a run is recorded at these files"),
      }), async ({ command, fresh }, { folder, caller }) => {
        const answer = await verifiedRun(folder, command, caller.session, fresh === true);
        return { text: runText(answer), data: { ...answer } };
      }, { consumers: ["agent"] });
    },
  };
}

/** The tool part named in the package's manifest (ADR-1021). */
export const testRunToolParts = [(): ToolExtension => testRunTools()];

/** Its section of the habits card (ADR-1021, the guidance kind). */
export const testRunGuidance: readonly string[] = [
  "Test with `run_tests`: unchanged files reuse its recorded run.",
];

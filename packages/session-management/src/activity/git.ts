/**
 * Capability 2 · Agent activity log, beside Capability 3 · Hooks. How storytree's own reads run git in a folder it records
 * (contract 3.46): with the repository's own configured commands switched off. A repository's config can name a program
 * git starts when it reads the working tree (core.fsmonitor) and a folder of programs it starts around its commands
 * (core.hooksPath); a folder's config is its own, so a hook reading it never lets either run. Options on git's command
 * line come before the repository's config.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

/** What one git read is run with: the folder it runs in, and its stdin, time limit and largest answer. */
export interface GitOptions {
  readonly cwd: string;
  readonly input?: string | Buffer;
  readonly timeout?: number;
  readonly maxBuffer?: number;
}

/** Run git with `args` in `options.cwd` and return what it printed; thrown when git fails. */
export type Git = (args: readonly string[], options: GitOptions) => string;

/** A folder that can never exist: one inside the Node program's own file. */
const NO_HOOKS = path.join(process.execPath, "no-git-hooks");

/** What every git storytree runs is started with first: no file-system monitor and no hooks of the repository's. */
export const NO_REPOSITORY_COMMANDS: readonly string[] = ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${NO_HOOKS}`];

/** Git as storytree runs it, with no shell and none of the repository's own commands. */
export const runGit: Git = (args, { cwd, input, timeout, maxBuffer }) =>
  execFileSync("git", [...NO_REPOSITORY_COMMANDS, ...args], {
    cwd, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"], windowsHide: true,
    ...(input === undefined ? {} : { input }), ...(timeout === undefined ? {} : { timeout }), ...(maxBuffer === undefined ? {} : { maxBuffer }),
  });

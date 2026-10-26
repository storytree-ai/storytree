/**
 * Capability 2 · Agent activity log, beside Capability 3 · Hooks. How storytree's own reads run git in a folder it records
 * (contract 3.46): with the repository's own configured commands switched off. A repository's config can name a program
 * git starts when it reads the working tree (core.fsmonitor) and a folder of programs it starts around its commands
 * (core.hooksPath); a folder's config is its own, so a hook reading it never lets either run. Options on git's command
 * line come before the repository's config. It can also name the commands a clean filter runs on a file's content;
 * those are switched off by name (filtersOff), keeping git's own line-ending conversion.
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

/**
 * Options that switch off every clean filter the repository's config in `cwd` names: the command each starts on a file's
 * content, and its demand to succeed. Git's own conversions (line endings, ident) still apply, so a file's hash matches
 * its index entry unless a configured filter changed it there. Throws when git cannot say, or a filter's name cannot be
 * given on git's command line.
 */
export function filtersOff(git: Git, cwd: string, timeout?: number): string[] {
  let names: string;
  try {
    names = git(["config", "--name-only", "--get-regexp", "^filter\\."], { cwd, ...(timeout === undefined ? {} : { timeout }) });
  } catch (error) {
    // Exit 1 is git's "no such key": no filter is configured.
    if ((error as { status?: unknown }).status === 1) return [];
    throw error;
  }
  const drivers = new Set(names.split(/\r?\n/).filter((name) => name !== "").map((name) => name.slice("filter.".length, name.lastIndexOf("."))));
  return [...drivers].flatMap((driver) => {
    if (driver.includes("=")) throw new Error(`a clean filter named ${JSON.stringify(driver)} cannot be switched off`);
    return ["-c", `filter.${driver}.clean=`, "-c", `filter.${driver}.process=`, "-c", `filter.${driver}.required=false`];
  });
}

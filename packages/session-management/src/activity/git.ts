// Capability 2 · Agent activity log
import { execFileSync } from "node:child_process";
import path from "node:path";

export interface GitOptions {
  readonly cwd: string;
  readonly input?: string | Buffer;
  readonly timeout?: number;
  readonly maxBuffer?: number;
}

export type Git = (args: readonly string[], options: GitOptions) => string;

const NO_HOOKS = path.join(process.execPath, "no-git-hooks");

export const NO_REPOSITORY_COMMANDS: readonly string[] = ["-c", "core.fsmonitor=false", "-c", `core.hooksPath=${NO_HOOKS}`];

export const runGit: Git = (args, { cwd, input, timeout, maxBuffer }) =>
  execFileSync("git", [...NO_REPOSITORY_COMMANDS, ...args], {
    cwd, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"], windowsHide: true,
    ...(input === undefined ? {} : { input }), ...(timeout === undefined ? {} : { timeout }), ...(maxBuffer === undefined ? {} : { maxBuffer }),
  });

export function filtersOff(git: Git, cwd: string, timeout?: number): string[] {
  let names: string;
  try {
    names = git(["config", "--name-only", "--get-regexp", "^filter\\."], { cwd, ...(timeout === undefined ? {} : { timeout }) });
  } catch (error) {
    if ((error as { status?: unknown }).status === 1) return [];
    throw error;
  }
  const drivers = new Set(names.split(/\r?\n/).filter((name) => name !== "").map((name) => name.slice("filter.".length, name.lastIndexOf("."))));
  return [...drivers].flatMap((driver) => {
    if (driver.includes("=")) throw new Error(`a clean filter named ${JSON.stringify(driver)} cannot be switched off`);
    return ["-c", `filter.${driver}.clean=`, "-c", `filter.${driver}.process=`, "-c", `filter.${driver}.required=false`];
  });
}

/**
 * Capability 1 · Front door (stories/cli.md). Not built yet.
 */

/** Where a command runs, and where its answer goes. */
export interface Io {
  readonly cwd: string;
  out(text: string): void;
  err(text: string): void;
}

/** Run one `storytree` command, and return the exit code. */
export async function run(_argv: readonly string[], io: Io): Promise<number> {
  io.err("storytree: the command line is not built yet\n");
  return 1;
}

/**
 * Capability 6 · Agent tools. Contract 6.45 · The tool server exits with code 0 when a delivery ran
 * during its shutdown.
 *
 * A fetch leaves its WebAssembly parser tiering up on V8's background threads. process.exit() while
 * one is in flight aborts Node on Windows ARM (libuv's async.c assertion, exit 0xC0000409), and no
 * dispatcher close prevents it. Leaving the process to end on its own lets Node drain that
 * background work first; the forced exit is only for close work that leaves something holding on.
 */

/** Runs the server's close work once, then lets the process end on its own. */
export function shutdownOnce(options: {
  input: NodeJS.ReadableStream & { destroy(): void };
  work: () => Promise<unknown>[];
  graceMs?: number;
}): () => void {
  let stopping = false;
  return () => {
    if (stopping) return;
    stopping = true;
    void Promise.allSettled(options.work()).finally(() => {
      process.exitCode = 0;
      options.input.destroy();
      setTimeout(() => process.exit(0), options.graceMs ?? 5_000).unref();
    });
  };
}

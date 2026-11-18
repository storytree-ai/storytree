// Capability 6 · Tool server (the MCP server)

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
      // eslint-disable-next-line storytree/no-comments -- the deferred exit looks like a slip to be "fixed"
      // An immediate process.exit() while fetch's WebAssembly parser tiers up aborts Node on Windows ARM (0xC0000409): let the process end on its own.
      setTimeout(() => process.exit(0), options.graceMs ?? 5_000).unref();
    });
  };
}

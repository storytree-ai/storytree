/**
 * Capability 3 · Story node render: a real-browser test file ends its Chrome without waiting on Chrome's pipes (3.100).
 * Playwright's `kill()` of a server it launched waits for the child's 'close', which comes only once every stdio pipe closes; a
 * Chrome helper surviving on a loaded Windows runner keeps them open, so the kill never resolves and its pipes and the server's
 * websocket listener hold the file's process alive after its last test (increment_16c18fc1c398; PR #1279's macOS answer in
 * apps/desktop's capture is the same).
 */
import type { ChildProcess } from "node:child_process";

/** What ending needs of a launched server: Playwright's BrowserServer is one. */
export type EndableServer = { kill(): Promise<void>; process(): ChildProcess };

/** End `browser` and `server`, both started and neither awaited, then let go of Chrome's process so nothing of it holds Node's. */
export function endChrome(server: EndableServer | undefined, browser: { close(): Promise<void> } | undefined): void {
  browser?.close().catch(() => {});
  if (server === undefined) return;
  const child = server.process();
  server.kill().catch(() => {});
  // Destroying our ends of the pipes lets 'close' fire once Chrome has exited, which closes the server's listener.
  for (const stream of child.stdio) stream?.destroy();
  child.unref();
}

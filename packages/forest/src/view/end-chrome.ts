// Capability 3 · Story node render
import type { ChildProcess } from "node:child_process";

export type EndableServer = { kill(): Promise<void>; process(): ChildProcess };

export function endChrome(server: EndableServer | undefined, browser: { close(): Promise<void> } | undefined): void {
  browser?.close().catch(() => {});
  if (server === undefined) return;
  const child = server.process();
  server.kill().catch(() => {});
  for (const stream of child.stdio) stream?.destroy();
  child.unref();
}

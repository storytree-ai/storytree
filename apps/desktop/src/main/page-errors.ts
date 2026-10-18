/** Capability 1 · Lifecycle. What the window's page says went wrong, kept in the app's log so a failure inside the window can be read after the fact (contract 1.19). */
export interface PageContents {
  on(event: "console-message", listener: (details: { level: string; message: string; sourceId: string; lineNumber: number }) => void): unknown;
  on(event: "render-process-gone", listener: (event: unknown, details: { reason: string; exitCode: number }) => void): unknown;
}

/** Write each error the page logs (a surface's failed refresh, an uncaught throw) and its renderer going away to `log`; the page's other logging stays out. */
export function logPageErrors(contents: PageContents, log: (line: string) => void): void {
  contents.on("console-message", ({ level, message, sourceId, lineNumber }) => {
    if (level === "error") log(`page error (${sourceId}:${lineNumber}): ${message}`);
  });
  contents.on("render-process-gone", (_event, { reason, exitCode }) => log(`page's renderer gone: ${reason} (exit code ${exitCode})`));
}

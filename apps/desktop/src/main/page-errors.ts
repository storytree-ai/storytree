// Capability 9 · Errors and app.log
export interface PageContents {
  on(event: "console-message", listener: (details: { level: string; message: string; sourceId: string; lineNumber: number }) => void): unknown;
  on(event: "render-process-gone", listener: (event: unknown, details: { reason: string; exitCode: number }) => void): unknown;
}

export function logPageErrors(contents: PageContents, log: (line: string) => void): void {
  contents.on("console-message", ({ level, message, sourceId, lineNumber }) => {
    if (level === "error") log(`page error (${sourceId}:${lineNumber}): ${message}`);
  });
  contents.on("render-process-gone", (_event, { reason, exitCode }) => log(`page's renderer gone: ${reason} (exit code ${exitCode})`));
}

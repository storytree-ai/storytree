/**
 * What storytree has to tell a session about claims made from its edits (ADR-0924 D2, D3), kept on
 * this machine under the storytree home until the session's next prompt, when the prompt hook takes
 * them: so telling a session never makes it wait on storytree.
 *
 * A session's notices are one file of lines, appended; taking them renames the file first, so two
 * prompt hooks at once never both print one, and a notice left while they are taken waits for the next.
 * A file nobody took for two days is for a session that is not on this machine, and is removed.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

/** A session id that is safe as a file name; any other is never written or read. */
const SAFE = /^[A-Za-z0-9._-]+$/;
const FORGOTTEN_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

function folderOf(home: string): string {
  return path.join(home, "claim-notices");
}

/** Keep `text` for `session`'s next prompt on this machine. */
export function leaveNotice(home: string, session: string, text: string): void {
  if (!SAFE.test(session)) return;
  const folder = folderOf(home);
  mkdirSync(folder, { recursive: true });
  appendFileSync(path.join(folder, `${session}.jsonl`), `${JSON.stringify(text)}\n`);
}

/** Every notice left for `session` on this machine, oldest first, each given only once. Never throws. */
export function takeNotices(home: string, session: string): string[] {
  if (!SAFE.test(session)) return [];
  const folder = folderOf(home);
  const taking = path.join(folder, `${session}.${process.pid}.taking`);
  try {
    renameSync(path.join(folder, `${session}.jsonl`), taking);
  } catch {
    return [];
  }
  try {
    return readFileSync(taking, "utf8").split("\n").filter((line) => line !== "").flatMap((line): string[] => {
      try {
        const text: unknown = JSON.parse(line);
        return typeof text === "string" ? [text] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  } finally {
    rmSync(taking, { force: true });
    forgetStale(folder);
  }
}

/** Remove notices no session on this machine took for two days. */
function forgetStale(folder: string): void {
  try {
    const now = Date.now();
    for (const name of readdirSync(folder)) {
      const file = path.join(folder, name);
      if (now - statSync(file).mtimeMs > FORGOTTEN_AFTER_MS) rmSync(file, { force: true });
    }
  } catch {
    // Kept until the next look: only space.
  }
}

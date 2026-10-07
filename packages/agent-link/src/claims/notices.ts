/**
 * Capability 5 · Claims: what storytree tells a session about claims made from its edits, kept on
 * this machine under the storytree home until the session's next prompt, when the prompt hook takes
 * them: so telling a session never makes it wait on storytree.
 *
 * A session's notices are one file of lines, appended; taking them renames the file first, so two
 * prompt hooks at once never both print one, and a notice left while they are taken waits for the next.
 * A file nobody took for two days is for a session that is not on this machine, and is removed.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

/** A session id that is safe as a file name; any other is never written or read. */
const SAFE = /^[A-Za-z0-9._-]+$/;
const FORGOTTEN_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

function folderOf(home: string): string {
  return path.join(home, "claim-notices");
}

/** Keep `text` for `session`'s next prompt on this machine. */
export function leaveNotice(home: string, session: string, text: string, capability?: string): void {
  append(home, session, capability === undefined ? text : { text, capability });
}

/** Release and automatic announcement are appended under the claim lock, in their actual order. */
export function cancelClaimNotice(home: string, session: string, capability: string): void {
  if (!SAFE.test(session) || !existsSync(path.join(folderOf(home), `${session}.jsonl`))) return;
  try { append(home, session, { released: capability }); } catch { /* A local notice must not prevent release. */ }
}

function append(home: string, session: string, value: unknown): void {
  if (!SAFE.test(session)) return;
  const folder = folderOf(home);
  mkdirSync(folder, { recursive: true });
  appendFileSync(path.join(folder, `${session}.jsonl`), `${JSON.stringify(value)}\n`);
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
    let notices: { text: string; capability?: string }[] = [];
    for (const line of readFileSync(taking, "utf8").split("\n").filter((line) => line !== "")) {
      try {
        const value: unknown = JSON.parse(line);
        if (typeof value === "string") notices.push({ text: value });
        else if (value !== null && typeof value === "object") {
          if ("released" in value && typeof value.released === "string") {
            const capability = value.released;
            // Old builds left plain strings. Their claimed notices include the capability id.
            notices = notices.filter((notice) => notice.capability !== capability && !(notice.capability === undefined && notice.text.includes(`(${capability})`)));
          } else if ("text" in value && typeof value.text === "string" && "capability" in value && typeof value.capability === "string") {
            notices.push({ text: value.text, capability: value.capability });
          }
        }
      } catch {
        // A partial or invalid line is no notice.
      }
    }
    return notices.map(({ text }) => text);
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

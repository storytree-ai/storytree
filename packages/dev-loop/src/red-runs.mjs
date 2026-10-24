// Capability 6 · Running the tests. The checkout's red runs (ADR-1153 D3): each test a run saw fail, kept in
// .pgtest/red-runs.jsonl, one JSON line { at, head, file, test } per failure, `test` its full name ("suite › title"),
// or null for a file that failed before any test in it ended. Lines are only added, so the green run that follows
// never erases the red; the change-reviewer's brief reads them to show each new test's red without re-running it
// (packages/quality-assurance, contract 2.14). Nothing here runs in CI's time: it is a file write after the run.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/** Add the failures of a run's units (runUnit's `tests` and `unloaded`) to the red runs of the checkout at `root`. */
export function recordReds(root, { tests = [], unloaded = [] }) {
  const failed = [...tests.filter((test) => test.result === "fail").map(({ file, name }) => ({ file, test: name })), ...unloaded.map((file) => ({ file, test: null }))];
  if (failed.length === 0) return;
  const at = new Date().toISOString();
  let head = "";
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
  } catch {
    // A checkout with no commit keeps its reds with no head.
  }
  const file = path.join(root, ".pgtest", "red-runs.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, failed.map((row) => `${JSON.stringify({ at, head, ...row })}\n`).join(""));
}

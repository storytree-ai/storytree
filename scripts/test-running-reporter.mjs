// A node:test reporter that prints nothing. It writes one line per test as it starts and as it
// completes to the file STORYTREE_TEST_RUNNING names, so that when scripts/unit-run.mjs kills a
// unit at its deadline it can say which tests were still running (ADR-0731).
// Node's spec reporter prints a test only once it has finished.
import { closeSync, openSync, writeSync } from "node:fs";

export default async function* running(source) {
  const file = process.env.STORYTREE_TEST_RUNNING;
  const fd = file ? openSync(file, "a") : undefined;
  try {
    for await (const event of source) {
      if (fd === undefined || (event.type !== "test:dequeue" && event.type !== "test:complete")) continue;
      const { file: testFile, name, nesting } = event.data;
      writeSync(fd, `${JSON.stringify({ event: event.type === "test:dequeue" ? "start" : "end", file: testFile, name, nesting })}\n`);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

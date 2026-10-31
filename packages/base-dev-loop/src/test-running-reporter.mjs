// Capability 4 · Running the tests. Supplement node's spec reporter: record running tests and completed failures before the unit
// deadline (ADR-0731). Spec prints ERR_TEST_FAILURE.cause, losing the wrapper's exit
// code and signal; a process that dies before reporting a test otherwise says only "test failed".
import { closeSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import { inspect } from "node:util";

const STDERR_LIMIT = 16 * 1024; // keep a tail per file, not an unbounded log of the whole unit

export default async function* running(source) {
  const file = process.env.STORYTREE_TEST_RUNNING;
  const fd = file ? openSync(file, "a") : undefined;
  const stderr = new Map();
  const failures = [];
  const names = new Map(); // each test's name and parent, by file and id, for its full name
  try {
    for await (const event of source) {
      const { data } = event;
      if (event.type === "test:stderr") {
        // stderr uses the supplied path; file failures use an absolute path.
        const key = data.file ? path.resolve(data.file) : undefined;
        const previous = stderr.get(key) ?? { text: "", truncated: false };
        const text = previous.text + data.message;
        stderr.set(key, { text: text.slice(-STDERR_LIMIT), truncated: previous.truncated || text.length > STDERR_LIMIT });
      }
      // test:fail is ordered: an earlier hung file can hold it until the unit is killed.
      // test:complete arrives when the test finishes, independently of that reporting order.
      if (event.type === "test:complete") {
        const error = data.details?.error;
        if (error && error.failureType !== "subtestsFailed") {
          // Spec saves assertion details for the final recap, which a unit deadline can erase.
          const location = [data.file, data.line, data.column].filter((part) => part !== undefined).join(":");
          yield `\ntest harness: completed failure\n${location} › ${data.name} (${data.details.duration_ms} ms)\n${inspect(error, { colors: false, depth: 5 })}\n`;
        }
      }
      if (event.type === "test:fail") {
        const error = data.details?.error;
        const isFile = data.nesting === 0 && data.file && (data.name === data.file || data.name === path.basename(data.file));
        if (error && error.failureType !== "subtestsFailed" && (isFile || Object.hasOwn(error, "exitCode") || Object.hasOwn(error, "signal"))) {
          failures.push({ file: data.file ?? data.name, error });
        }
      }
      // File stderr can trail its completion event. Keep the final recap with the full tail,
      // alongside the immediate diagnostic above that survives a killed unit.
      if (event.type === "test:summary" && data.file === undefined && failures.length > 0) {
        const lines = ["\ntest harness: file failures"];
        for (const { file, error } of failures) {
          const captured = stderr.get(path.resolve(file));
          lines.push(`${file}\n  exit code: ${error.exitCode ?? "none"}; signal: ${error.signal ?? "none"}`);
          lines.push(captured?.text
            ? `  stderr:${captured.truncated ? " (tail; earlier output omitted)" : ""}\n  ${captured.text.trimEnd().replaceAll("\n", "\n  ")}`
            : "  stderr: (empty)");
          lines.push(`  ${error.code ?? "error"}: ${error.message}`);
        }
        yield `${lines.join("\n")}\n`;
      }
      if (fd === undefined || (event.type !== "test:dequeue" && event.type !== "test:complete")) continue;
      const { file: testFile, name, nesting, testId, parentId } = event.data;
      const entry = { event: event.type === "test:dequeue" ? "start" : "end", file: testFile, name, nesting, at: Date.now() };
      // A test inside a file that ran (not skipped or todo) ends with its full name, time and result:
      // what unit-run.mjs gives back for each test's limit to be learned from (ADR-1152).
      // The file's own entry is named by the path it was given, which its absolute one ends with.
      const isFile = nesting === 0 && testFile && `/${testFile.replaceAll("\\", "/")}`.endsWith(`/${name.replaceAll("\\", "/").replace(/^\.\//, "")}`);
      // A file's own end says whether it passed, so a file that failed before any test in it ended (a red import) is kept (ADR-1153 D3).
      if (isFile && event.type === "test:complete") entry.passed = event.data.details.passed;
      if (!isFile && testFile !== undefined) {
        const key = (id) => `${testFile}\0${id}`;
        if (event.type === "test:dequeue") names.set(key(testId), { name, parentId });
        else if (!event.data.skip && !event.data.todo) {
          const chain = [name];
          for (let parent = names.get(key(testId))?.parentId; names.has(key(parent)); parent = names.get(key(parent)).parentId) chain.unshift(names.get(key(parent)).name);
          Object.assign(entry, { fullName: chain.join(" › "), ms: event.data.details.duration_ms, passed: event.data.details.passed, timeout: event.data.details.error?.failureType === "testTimeoutFailure" });
        }
      }
      writeSync(fd, `${JSON.stringify(entry)}\n`);
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

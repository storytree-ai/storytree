// Capability 6 · Running the tests. The red runs of a test run `pnpm test` does not drive (ADR-1153 D3): a node:test reporter a
// checkout outside storytree, such as a user's factory, gives its own `node --test` by this package's name
// (`--test-reporter=@storytree/dev-loop/red-run-reporter`), so each test that failed, by its full name ("suite › title"), and each
// file that failed before any test in it ended, is kept in that checkout's red runs as `pnpm test` keeps them (red-runs.mjs),
// where the change-reviewer's brief reads them (packages/quality-assurance, contract 2.14). The checkout is the Git checkout
// the run starts in, else its folder. It prints nothing: give it a destination beside the reporter that does.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { recordReds } from "./red-runs.mjs";

export default async function* redRuns(source) {
  const names = new Map(); // each test's name and parent, by file and id, for its full name
  const tests = [];
  const files = new Map(); // each file's own end: whether it passed
  for await (const event of source) {
    if (event.type !== "test:dequeue" && event.type !== "test:complete") continue;
    const { file, name, nesting, testId, parentId } = event.data;
    if (file === undefined) continue;
    // The file's own entry is named by the path it was given, which its absolute one ends with.
    if (nesting === 0 && `/${file.replaceAll("\\", "/")}`.endsWith(`/${name.replaceAll("\\", "/").replace(/^\.\//, "")}`)) {
      if (event.type === "test:complete") files.set(file, event.data.details.passed);
      continue;
    }
    const key = (id) => `${file}\0${id}`;
    if (event.type === "test:dequeue") names.set(key(testId), { name, parentId });
    else if (!event.data.skip && !event.data.todo) {
      const chain = [name];
      for (let parent = names.get(key(testId))?.parentId; names.has(key(parent)); parent = names.get(key(parent)).parentId) chain.unshift(names.get(key(parent)).name);
      const failed = !event.data.details.passed && event.data.details.error?.failureType !== "subtestsFailed"; // a suite fails only by its tests
      tests.push({ file, name: chain.join(" › "), result: failed ? "fail" : "pass" });
    }
  }
  const root = checkout(process.cwd());
  const from = (file) => path.relative(root, real(path.resolve(file))).replaceAll("\\", "/");
  const ran = new Set(tests.map(({ file }) => file));
  recordReds(root, {
    tests: tests.map((test) => ({ ...test, file: from(test.file) })),
    unloaded: [...files].filter(([file, passed]) => !passed && !ran.has(file)).map(([file]) => from(file)),
  });
}

/** The Git checkout `dir` is in, else `dir` itself, by its real path. */
function checkout(dir) {
  try {
    return real(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim());
  } catch {
    return real(dir);
  }
}

/** A path by its real path, as macOS names a temporary folder one way for its tests and another (under /private) for itself. */
function real(file) {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

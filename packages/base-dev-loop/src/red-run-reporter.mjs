// Capability 4 · Running the tests
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

import { recordReds } from "./red-runs.mjs";

export default async function* redRuns(source) {
  await keepReds(source, process.cwd());
}

export async function keepReds(source, dir) {
  const names = new Map();
  const tests = [];
  const files = new Map();
  for await (const event of source) {
    if (event.type !== "test:dequeue" && event.type !== "test:complete") continue;
    const { file, name, nesting, testId, parentId } = event.data;
    if (file === undefined) continue;
    if (nesting === 0 && `/${file.replaceAll("\\", "/")}`.endsWith(`/${name.replaceAll("\\", "/").replace(/^\.\//, "")}`)) {
      if (event.type === "test:complete") files.set(file, event.data.details.passed);
      continue;
    }
    const key = (id) => `${file}\0${id}`;
    if (event.type === "test:dequeue") names.set(key(testId), { name, parentId });
    else if (!event.data.skip && !event.data.todo) {
      const chain = [name];
      for (let parent = names.get(key(testId))?.parentId; names.has(key(parent)); parent = names.get(key(parent)).parentId) chain.unshift(names.get(key(parent)).name);
      const failed = !event.data.details.passed && event.data.details.error?.failureType !== "subtestsFailed";
      tests.push({ file, name: chain.join(" › "), result: failed ? "fail" : "pass" });
    }
  }
  const root = checkout(dir);
  const from = (file) => path.relative(root, real(path.resolve(dir, file))).replaceAll("\\", "/");
  const ran = new Set(tests.map(({ file }) => file));
  recordReds(root, {
    tests: tests.map((test) => ({ ...test, file: from(test.file) })),
    unloaded: [...files].filter(([file, passed]) => !passed && !ran.has(file)).map(([file]) => from(file)),
  });
}

function checkout(dir) {
  try {
    return real(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim());
  } catch {
    return real(dir);
  }
}

function real(file) {
  try {
    return realpathSync.native(file);
  } catch {
    return file;
  }
}

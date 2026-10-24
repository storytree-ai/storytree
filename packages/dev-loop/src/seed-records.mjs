// Capability 7 · The gate. A committed evidence seed or snapshot holds only what the forest's seed sanitiser keeps
// (packages/forest/src/snapshot/evidence-seed.ts): this check reads every seed or snapshot file the branch adds or
// changes and refuses one that holds a work record, a withheld arc or a redaction pattern. When git cannot say what
// changed it reads every one in the checkout. It reads only files, so CI runs it too; `pnpm gate` runs it as
// check:seed-records.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

import { seedProblems } from "@storytree/forest/evidence-seed";

import { changedFiles } from "./test-scope.mjs";

/** A library dump a capture replays (`seed.json`, `seed.json.gz`, `<name>-seed.json…`) or the website's forest snapshot. */
export function isSeedFile(file) {
  const name = path.posix.basename(file);
  return /(^|[-.])seed\.json(\.gz)?$/.test(name) || name === "forest-snapshot.json";
}

/** The seed and snapshot files to read: those the branch adds or changes, or every one when git cannot say. */
export function seedFilesFor(root, changed = () => changedFiles(root)) {
  let files;
  try {
    files = changed();
  } catch {
    files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  }
  return files.filter(isSeedFile).filter((file) => existsSync(path.join(root, file))).sort();
}

/** Each problem with the given seed and snapshot files, one sentence each; empty when every one is clean. */
export function seedRecordProblems(root, files) {
  return files.flatMap((file) => {
    const bytes = readFileSync(path.join(root, file));
    return seedProblems(file, (file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const files = seedFilesFor(root);
  const problems = seedRecordProblems(root, files);
  if (problems.length > 0) {
    console.error(`A committed seed or snapshot holds what the seed sanitiser drops:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    process.exitCode = 1;
  } else console.log(`${files.length} changed seed or snapshot file${files.length === 1 ? "" : "s"}, each clean`);
}

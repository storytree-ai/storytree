// Capability 2 · Seed and evidence records check
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

import { captureProblems, captureText, scrubCapture, seedProblems } from "@storytree/forest/evidence-seed";

import { changedFiles } from "@storytree/base-dev-loop/test-scope";

export function isSeedFile(file) {
  const name = path.posix.basename(file);
  return /(^|[-.])seed\.json(\.gz)?$/.test(name) || name === "forest-snapshot.json" || name === "shop-snapshot.json";
}

export function isCaptureFile(file) {
  return /(^|\/)evidence\//.test(file) && /\.(jsonl|log|tsv|cpuprofile)$/.test(file);
}

export function seedFilesFor(root, changed = () => changedFiles(root)) {
  let files;
  try {
    files = changed();
  } catch {
    files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  }
  return files.filter((file) => isSeedFile(file) || isCaptureFile(file)).filter((file) => existsSync(path.join(root, file))).sort();
}

export function snapshotProblems(file, text) {
  const problems = seedProblems(file, text).filter((problem) => !/ holds an increment record /.test(problem));
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value === null || typeof value !== "object") return;
    if (value.type === "increment" && value.fields) {
      for (const field of ["objective", "outcome", "body"]) if (field in value.fields) problems.push(`${file}: ${value.id} keeps its ${field}: refresh it through the website's snapshot builder`);
    }
    Object.values(value).forEach(walk);
  };
  const said = (snapshot) => {
    for (const [id, waits] of Object.entries(snapshot?.holds?.waits ?? {})) {
      for (const wait of Array.isArray(waits) ? waits : []) if (wait?.reason) problems.push(`${file}: ${id}'s wait on ${wait.on} keeps its reason: refresh it through the website's snapshot builder`);
    }
    const lines = snapshot?.recording?.lines;
    for (const line of Array.isArray(lines) ? lines : []) {
      for (const field of ["reason", "why", "title"]) if (line?.[field]) problems.push(`${file}: recorded line ${line.seq} keeps its ${field}: refresh it through the website's snapshot builder`);
    }
  };
  try {
    const snapshot = JSON.parse(text);
    walk(snapshot);
    said(snapshot);
  } catch {
    problems.push(`${file} is not JSON`);
  }
  return problems;
}

export function seedRecordProblems(root, files) {
  return files.flatMap((file) => {
    const bytes = readFileSync(path.join(root, file));
    if (isCaptureFile(file)) return captureProblems(file, bytes);
    if (path.posix.basename(file) === "forest-snapshot.json") return snapshotProblems(file, bytes.toString("utf8"));
    if (path.posix.basename(file) === "shop-snapshot.json") return seedProblems(file, bytes.toString("utf8")).filter((problem) => !/ holds an? \w+ record /.test(problem));
    return seedProblems(file, (file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8"));
  });
}

export function scrubEvidence(folder) {
  const changed = [];
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name);
    if (!entry.isFile() || !(isCaptureFile(`evidence/${entry.name}`) || entry.name.endsWith(".txt"))) continue;
    const bytes = readFileSync(file);
    const scrubbed = scrubCapture(captureText(bytes));
    if (Buffer.compare(Buffer.from(scrubbed, "utf8"), bytes) === 0) continue;
    writeFileSync(file, scrubbed, "utf8");
    changed.push(file);
  }
  return changed.sort();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2] === "--scrub") {
  const folder = path.resolve(process.argv[3] ?? ".");
  const changed = scrubEvidence(folder);
  console.log(`${changed.length} capture${changed.length === 1 ? "" : "s"} scrubbed under ${folder}`);
} else if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  const files = seedFilesFor(root);
  const problems = seedRecordProblems(root, files);
  if (problems.length > 0) {
    console.error(`A committed seed, snapshot or capture holds what the sanitisers drop:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    process.exitCode = 1;
  } else console.log(`${files.length} changed seed, snapshot or capture file${files.length === 1 ? "" : "s"}, each clean`);
}

// Capability 8 · Storytree's own test and gate entries. A minified bundle committed under docs/design is named *.min.js
// (increment_25ec3aa5f204; Mick's voice notes voice.note_8c98f9bb3c72 and voice.note_0742fc323676, question_878200d16277
// option 3): CodeQL's JavaScript extractor skips a file whose name says it is minified, so third-party code bundled into
// a design sketch (three.js, react) raises no alerts while hand-written sketch code stays scanned. `pnpm lint` (lint.mjs)
// refuses a .js there with a line over 1,000 characters named any other way, unless the whole file is one data assignment
// (`window.NAME = {…};`, the value parsing as JSON), which holds no code to scan. No file is exempt by its name.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SKETCHES = "docs/design";
const LONG_LINE = 1000;
const MINIFIED_NAME = /[.-]min\.js$/;
const DATA_ASSIGNMENT = /^\s*window\.[A-Za-z_$][\w$]*\s*=\s*(\{[\s\S]*\})\s*;?\s*$/;

/** Whether `text` is only `window.NAME = {…};` with a value that parses as JSON. */
export function isDataAssignment(text) {
  const value = DATA_ASSIGNMENT.exec(text)?.[1];
  if (value === undefined) return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/** One sentence per .js under docs/design in the checkout at `root` that is minified but not named so. */
export function sketchBundleProblems(root) {
  const problems = [];
  for (const file of jsFiles(root, SKETCHES)) {
    if (MINIFIED_NAME.test(file)) continue;
    const text = readFileSync(path.join(root, file), "utf8");
    if (!text.split("\n").some((line) => line.length > LONG_LINE) || isDataAssignment(text)) continue;
    const named = path.posix.basename(file).replace(/\.js$/, ".min.js");
    problems.push(`${file} has a line over ${LONG_LINE} characters, so it reads as a minified bundle CodeQL would scan: name it ${named} (in the build.mjs that writes it, and in its page's script tag), or keep it to one data assignment`);
  }
  return problems;
}

function jsFiles(root, dir) {
  let entries;
  try {
    entries = readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...jsFiles(root, rel));
    else if (entry.name.endsWith(".js")) files.push(rel);
  }
  return files;
}

// Capability 8 · Storytree's own test and gate entries.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const COMMAND = /\b(?:pgrep|pkill)\b/g;
const VALUE_FLAGS = new Set(["-d", "-F", "-g", "-G", "-P", "-s", "-t", "-u", "-U"]);
const QUOTE = /^\\?["']/;

function unanchored(command, words) {
  let flags = "";
  for (let at = 0; at < words.length; at++) {
    const word = words[at];
    if (VALUE_FLAGS.has(word)) at++;
    else if (/^-[A-Za-z]/.test(word)) flags += word.slice(1);
    else return flags.includes("f") && !(command === "pgrep" && /[al]/.test(flags)) && !word.replace(QUOTE, "").startsWith("^");
  }
  return false;
}

export function shellProblems(file, text) {
  const problems = [];
  text.split("\n").forEach((line, index) => {
    for (const found of line.matchAll(COMMAND)) {
      const command = found[0];
      if (!unanchored(command, line.slice(found.index + command.length).trim().split(/\s+/))) continue;
      problems.push(`${file}:${index + 1} ${command} -f matches a process command line by a pattern not anchored at its start, so a caller whose own ` +
        "command line holds the text matches too (escape_24ab852d292f): anchor it to the executable from the start of the line with ^");
    }
  });
  return problems;
}

export async function processMatchProblems(root) {
  const { stdout } = await promisify(execFile)("git", ["ls-files", "-z", "--", "*.sh"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const problems = [];
  for (const file of stdout.split("\0").filter(Boolean)) problems.push(...shellProblems(file, await readFile(path.join(root, file), "utf8")));
  return problems;
}

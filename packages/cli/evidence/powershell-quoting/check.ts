// changedByQuoting over the probe's captured lines: undefined for every standard quoter's, a word for PowerShell 5.1's changed ones.
import { readFileSync } from "node:fs";
import { changedByQuoting } from "../../src/handed.js";

const text = readFileSync(new URL("./probe.txt", import.meta.url), "utf8");
for (const row of text.split(/\r?\n/)) {
  const match = /^ {2}(\S.*?)\s{2,}(\{.*\})$/.exec(row);
  if (!match) { if (row.startsWith("==")) console.log(row.slice(0, 60)); continue; }
  const { argv, line } = JSON.parse(match[2]!) as { argv: string[]; line: string };
  const changed = changedByQuoting(line, argv);
  console.log(`  ${match[1]!.trim().padEnd(15)} ${changed === undefined ? "acts" : `refused at word ${changed + 1}`}`);
}
// A line that is not this command's own (its reading differs from the words that arrived) says nothing.
console.log("foreign line:", changedByQuoting('"say "hi""', ["something", "else"]) === undefined ? "ignored" : "MISREAD");

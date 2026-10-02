// Summarise the reviewer's sessions (reviews.ps1's output): each review's planned action (tool and
// arguments) and the reviewer's answer, in order. --full prints every message the reviewer was given.
// Usage: node reviews.mjs <reviews-file> [--full]
import { readFileSync } from "node:fs";
const raw = readFileSync(process.argv[2]);
const s = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le").slice(1) : raw.toString("utf8");
const full = process.argv.includes("--full");
for (const chunk of s.split(/^=== /m).filter(Boolean)) {
  const lines = chunk.split(/\r?\n/);
  console.log("=== reviewer session " + lines[0].trim());
  for (const l of lines.slice(1)) {
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.type !== "response_item" || j.payload?.type !== "message") continue;
    const text = (j.payload.content ?? []).map((c) => c.text ?? "").join("");
    if (j.payload.role === "assistant") console.log("  ANSWER " + text.replace(/\s+/g, " "));
    else if (full) console.log(`  [${j.payload.role}] ` + text);
    else {
      const m = text.match(/Planned action JSON:\s*(\{[\s\S]*?\})\s*>>> APPROVAL REQUEST END/);
      if (m) console.log("  ACTION " + m[1].replace(/\s+/g, " ").slice(0, 300));
    }
  }
}

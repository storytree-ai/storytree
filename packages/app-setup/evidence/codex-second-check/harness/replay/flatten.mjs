// Build a replay of one reviewer conversation up to its Nth review (1-based), flattened into one prompt.
import { readFileSync, writeFileSync } from "node:fs";
const [file, nth, out] = process.argv.slice(2);
const s = readFileSync(file, "utf8");
let base = ""; const msgs = []; let reviews = 0;
for (const l of s.split("\n")) {
  let j; try { j = JSON.parse(l); } catch { continue; }
  if (j.type === "session_meta") base = j.payload.base_instructions?.text ?? "";
  if (j.type === "response_item" && j.payload?.type === "message") {
    const text = (j.payload.content ?? []).map((c) => c.text ?? "").join("");
    if (j.payload.role === "assistant") { reviews++; if (reviews >= Number(nth)) break; }
    msgs.push({ role: j.payload.role, text });
  }
}
writeFileSync(out + ".base.md", base);
writeFileSync(out + ".prompt.md", msgs.map((m) => `<<${m.role}>>\n${m.text}`).join("\n\n") + "\n\nAnswer the latest approval request only, with the JSON object your instructions specify.");
console.log("messages", msgs.length, "base", base.length);

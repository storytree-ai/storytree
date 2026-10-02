// Split one reviewer conversation into its turns, up to its Nth review: <out>.t1.md, t2 ... (each turn's user/developer messages).
import { readFileSync, writeFileSync } from "node:fs";
const [file, nth, out] = process.argv.slice(2);
const s = readFileSync(file, "utf8");
let base = ""; let turn = []; const turns = []; let reviews = 0;
for (const l of s.split("\n")) {
  let j; try { j = JSON.parse(l); } catch { continue; }
  if (j.type === "session_meta") base = j.payload.base_instructions?.text ?? "";
  if (j.type === "response_item" && j.payload?.type === "message") {
    const text = (j.payload.content ?? []).map((c) => c.text ?? "").join("");
    if (j.payload.role === "assistant") { reviews++; turns.push(turn); turn = []; if (reviews >= Number(nth)) break; continue; }
    if (j.payload.role === "developer" && text.startsWith("<permissions")) continue;
    turn.push(j.payload.role === "developer" ? `[developer] ${text}` : text);
  }
}
writeFileSync(out + ".base.md", base);
turns.forEach((t, i) => writeFileSync(`${out}.t${i + 1}.md`, t.join("\n\n")));
console.log("turns", turns.length);

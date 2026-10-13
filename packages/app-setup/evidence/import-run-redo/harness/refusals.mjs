// Every tool result in a stream-json transcript that names storytree's guard, with the call it answered.
import { readFileSync } from "node:fs";
const raw = readFileSync(process.argv[2]);
const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le").slice(1) : raw.toString("utf8");
const calls = new Map();
for (const line of text.split(/\r?\n/)) {
  let m; try { m = JSON.parse(line); } catch { continue; }
  if (m.type === "assistant") for (const c of m.message.content ?? []) if (c.type === "tool_use") calls.set(c.id, c);
  if (m.type === "user") for (const c of m.message?.content ?? []) {
    const body = typeof c.content === "string" ? c.content : JSON.stringify(c.content ?? "");
    if (c.type === "tool_result" && /ADR-1015|refused before|explicit permission/.test(body)) {
      const call = calls.get(c.tool_use_id);
      console.log("CALL", call?.name, call?.input?.file_path ?? JSON.stringify(call?.input).slice(0, 200));
      console.log("RESULT", body, "\n");
    }
  }
}

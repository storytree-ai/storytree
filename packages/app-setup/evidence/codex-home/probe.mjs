import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
writeFileSync(process.env.PROBE_OUT ?? "seen.json", JSON.stringify({ CODEX_HOME: process.env.CODEX_HOME ?? null, keys: Object.keys(process.env).sort() }));
const rl = createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
rl.on("line", (l) => { const m = JSON.parse(l); if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "probe", version: "0" } } }); else if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [] } }); else if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, result: {} }); });

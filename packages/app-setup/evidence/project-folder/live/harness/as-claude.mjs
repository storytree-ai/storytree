// What a Claude Code session start sees from storytree, without Claude Code: run the SessionStart hooks
// registered in ~/.claude/settings.json and the tool server in ~/.claude.json, in <folder>, as Claude Code would.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const folder = process.argv[2];
const settings = JSON.parse(readFileSync(path.join(os.homedir(), ".claude", "settings.json"), "utf8"));
const input = JSON.stringify({ session_id: `pf-${Date.now()}`, transcript_path: "", cwd: folder, hook_event_name: "SessionStart", source: "startup" });
console.log(`== folder: ${folder}`);
for (const group of settings.hooks.SessionStart ?? []) for (const hook of group.hooks) {
  const ran = spawnSync(hook.command, hook.args ?? [], { input, encoding: "utf8", cwd: folder, timeout: 60000 });
  console.log(`start hook ${JSON.stringify(hook.args?.slice(1))}${hook.async ? " (async)" : ""}: exit ${ran.status}, stdout ${JSON.stringify(ran.stdout)}`);
}
const server = JSON.parse(readFileSync(path.join(os.homedir(), ".claude.json"), "utf8")).mcpServers.storytree;
const child = spawn(server.command, server.args, { cwd: folder, env: { ...process.env, ...(server.env ?? {}) }, stdio: ["pipe", "pipe", "inherit"] });
let buffer = ""; const waiting = new Map();
child.stdout.on("data", (chunk) => { buffer += chunk; let i; while ((i = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); try { const m = JSON.parse(line); waiting.get(m.id)?.(m); } catch {} } });
let id = 0; const call = (method, params) => new Promise((ok) => { const n = ++id; waiting.set(n, ok); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n"); });
await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1.283" } });
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
const answer = await call("tools/call", { name: "check_setup", arguments: {} });
console.log(`check_setup: ${answer.result?.content?.map((c) => c.text).join("\n") ?? JSON.stringify(answer)}`);
child.kill();

// Run the delivered commands from a temporary user's unrelated folder, with no checkout modules.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

export async function checkTools(node, dir, home) {
  mkdirSync(home, { recursive: true });
  const env = {
    ...process.env, HOME: home, USERPROFILE: home,
    STORYTREE_HOME: path.join(home, ".storytree", "0.3"),
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"), CODEX_HOME: path.join(home, ".codex"),
    CLAUDE_PROJECT_DIR: home, NODE_PATH: "", PATH: "", Path: "",
  };
  const run = (name, args = [], input = "") => spawnSync(node, [path.join(dir, `${name}.mjs`), ...args], { cwd: home, env, input, encoding: "utf8", timeout: 30_000 });
  const cli = run("storytree", ["help"]);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  const setup = run("storytree-setup", ["invalid"]);
  assert.equal(setup.status, 2, setup.stderr);
  const hook = run("storytree-hook", ["statusline"], "{}");
  assert.equal(hook.status, 0, hook.stderr);
  const delivery = run("storytree-deliver", ["invalid"]);
  assert.equal(delivery.status, 1, delivery.stderr);
  assert.match(delivery.stderr, /usage:/);
  // Asking the real server for its tools forces the bundled MCP protocol and imports to load.
  await new Promise((resolve, reject) => {
    const child = spawn(node, [path.join(dir, "storytree-mcp.mjs")], { cwd: home, env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    let listed = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error(`MCP tool listing timed out: ${errors}`)); }, 15_000);
    const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      let newline;
      while ((newline = output.indexOf("\n")) !== -1) {
        const line = output.slice(0, newline); output = output.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.id === 1) {
            assert.ok(message.result?.protocolVersion, line);
            send({ jsonrpc: "2.0", method: "notifications/initialized" });
            send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
          } else if (message.id === 2) {
            assert.ok(message.result?.tools?.some((tool) => tool.name === "check_setup"), line);
            listed = true;
            child.stdin.end();
          }
        } catch (error) { clearTimeout(timer); child.kill(); reject(error); }
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (listed && code === 0) resolve();
      else reject(new Error(`MCP exited ${code}: ${errors}`));
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "storytree-delivery-proof", version: "1" } } });
  });
}

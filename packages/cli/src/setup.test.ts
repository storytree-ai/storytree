/** App setup 2.1–2.6: the delivered people's command, outside a checkout or project. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { assertExitCode, BuiltCommand, storytree } from "./testing/cli.js";

const command = new BuiltCommand();
before(async () => {
  await command.build();
  // The same app-setup entry point packaged as storytree-deliver.mjs by desktop delivery.
  await build({
    stdin: { contents: 'import { runDeliveryCommand } from "@storytree/app-setup/deliver"; runDeliveryCommand().catch(e => { console.error(e.message); process.exitCode = 1; });', resolveDir: fileURLToPath(new URL("../../app-setup", import.meta.url)) },
    outfile: path.join(command.dir, "storytree-deliver.mjs"), bundle: true, platform: "node", format: "esm", target: "node24",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    external: ["pg-native", "pg-cloudflare", "cloudflare:sockets", "@google-cloud/cloud-sql-connector"],
  });
  writeFileSync(path.join(command.dir, "storytree-setup.mjs"), 'console.log(JSON.stringify(process.argv.slice(2)));');
});
after(() => command.remove());

function user(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), "storytree setup join "));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const home = path.join(dir, ".storytree", "0.3");
  const claude = path.join(dir, ".claude");
  const codex = path.join(dir, ".codex");
  const bin = path.join(dir, "bin");
  for (const folder of [home, claude, codex, bin]) mkdirSync(folder, { recursive: true });
  const mcp = path.join(dir, "installed tools", "storytree-mcp.mjs");
  mkdirSync(path.dirname(mcp));
  const node = path.join(path.dirname(mcp), process.platform === "win32" ? "node.exe" : "node");
  writeFileSync(node, "delivered Node fixture\n");
  writeFileSync(mcp, "// delivered server\n");
  const record = path.join(home, "delivery.json");
  writeFileSync(record, JSON.stringify({ schema: 1, installDir: dir, tools: { node, mcp } }));
  const settings = path.join(claude, ".claude.json");
  writeFileSync(settings, JSON.stringify({ theme: "kept", mcpServers: { other: { command: "keep" } } }));
  writeFileSync(path.join(codex, "config.toml"), '# keep my settings\nmodel = "kept"\n');
  // Only the external harnesses are fake. The installed helper and configuration edits are real.
  const fake = path.join(bin, "harness.mjs");
  writeFileSync(fake, `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('test harness'); process.exit(0); }
const file = path.join(process.env.CODEX_HOME, 'config.toml');
const source = existsSync(file) ? readFileSync(file, 'utf8') : '';
const block = /\\n?\\[mcp_servers\\.storytree\\]\\ncommand = (.+)\\nargs = (.+)\\n/.exec(source);
const server = block && { name: 'storytree', enabled: true, transport: { type: 'stdio', command: JSON.parse(block[1]), args: JSON.parse(block[2]) } };
if (args[1] === 'list') console.log(JSON.stringify(server ? [server] : []));
else if (args[1] === 'get') console.log(JSON.stringify(server));
else if (args[1] === 'remove') writeFileSync(file, source.replace(block[0], ''));
else process.exit(1);
`);
  for (const name of ["claude", "codex"]) {
    writeFileSync(path.join(bin, process.platform === "win32" ? `${name}.cmd` : name), process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`
      : `#!/bin/sh\nexec "${process.execPath}" "${fake}" "$@"\n`, { mode: 0o755 });
  }
  const env = { HOME: dir, USERPROFILE: dir, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex, PATH: bin };
  return { dir, record, settings, codex, node, mcp, bin, run: (args: string[]) => storytree(command.script, ["setup", ...args], { cwd: dir, home, env }) };
}

test("2.1 / 2.4 / 2.5 / 2.6: installed connect chooses both, retries unchanged and disconnects one without the other", async (t) => {
  const u = user(t);
  const first = await u.run(["connect", "--claude", "--codex"]);
  assertExitCode(first, 0);
  assert.match(first.stdout, /Claude Code: tools connected; hooks not verified/);
  assert.match(first.stdout, /Codex: tools connected; hooks not verified/);
  assert.match(first.stdout, /Start a new agent session in the folder/);
  const claude = readFileSync(u.settings, "utf8");
  const codex = readFileSync(path.join(u.codex, "config.toml"), "utf8");
  assert.deepEqual(JSON.parse(claude).mcpServers.storytree.args, [u.mcp]);
  assert.equal(JSON.parse(claude).mcpServers.storytree.command, u.node, "registration uses delivery's bundled Node, not the invoking runtime");
  assert.match(codex, /# keep my settings/);
  const second = await u.run(["connect", "--claude", "--codex"]);
  assertExitCode(second, 0);
  assert.match(second.stdout, /already connected/);
  assert.equal(readFileSync(u.settings, "utf8"), claude);
  assert.equal(readFileSync(path.join(u.codex, "config.toml"), "utf8"), codex);
  const removed = await u.run(["disconnect", "claude-code"]);
  assertExitCode(removed, 0);
  assert.match(removed.stdout, /Claude Code: tools disconnected/);
  assert.deepEqual(JSON.parse(readFileSync(u.settings, "utf8")), { theme: "kept", mcpServers: { other: { command: "keep" } } });
  assert.equal(readFileSync(path.join(u.codex, "config.toml"), "utf8"), codex);
  assertExitCode(await u.run(["disconnect", "codex"]), 0, "setup disconnect codex");
  const onlyCodex = await u.run(["connect", "--codex"]);
  assertExitCode(onlyCodex, 0);
  assert.doesNotMatch(onlyCodex.stdout, /Claude Code/);
  assert.equal(JSON.parse(readFileSync(u.settings, "utf8")).mcpServers.storytree, undefined);
  assert.equal(existsSync(path.join(u.dir, ".storytree.json")), false);
});

test("2.2 / 2.3: partial connection is nonzero, preserves a conflict and still connects the other agent", async (t) => {
  const u = user(t);
  const previous = JSON.stringify({ mcpServers: { storytree: { command: "storytree-02" } } });
  writeFileSync(u.settings, previous);
  const result = await u.run(["connect", "--claude", "--codex"]);
  assertExitCode(result, 1);
  assert.match(result.stderr, /Claude Code: tools not connected/);
  assert.match(result.stderr, /Codex: tools connected; hooks not verified/);
  assert.equal(readFileSync(u.settings, "utf8"), previous);
  assertExitCode(await u.run(["disconnect", "claude-code"]), 1, "setup disconnect claude-code");
});

test("2.1 / 2.2: explicit selection, a readable delivery record and installed tools are required", async (t) => {
  const u = user(t);
  for (const verb of ["install", "remove"]) {
    const hooks = await u.run([verb]);
    assertExitCode(hooks, 0);
    assert.deepEqual(JSON.parse(hooks.stdout), [verb], "existing hook command still receives its own arguments");
  }
  for (const args of [["connect"], ["connect", "--claud"], ["disconnect", "both"]]) {
    assertExitCode(await u.run(args), 2, `setup ${args.join(" ")}`);
  }
  rmSync(u.record);
  const missing = await u.run(["connect", "--claude"]);
  assertExitCode(missing, 1);
  assert.match(missing.stderr, /delivery.json.*[Rr]e-run.*installer/);
  writeFileSync(u.record, '{"schema":99}');
  assertExitCode(await u.run(["connect", "--claude"]), 1, "setup connect --claude with invalid delivery record");
  writeFileSync(u.record, JSON.stringify({ schema: 1, installDir: u.dir, tools: { node: u.node, mcp: u.mcp } }));
  rmSync(path.join(u.bin, process.platform === "win32" ? "claude.cmd" : "claude"));
  const noHarness = await u.run(["connect", "--claude"]);
  assertExitCode(noHarness, 1);
  assert.match(noHarness.stderr, /Install Claude Code, sign in/);
  rmSync(u.mcp);
  const absent = await u.run(["connect", "--claude"]);
  assertExitCode(absent, 1);
  assert.match(absent.stderr, /restore its bundled Node and tool server/);
  assert.equal(JSON.parse(readFileSync(u.settings, "utf8")).mcpServers.storytree, undefined);
});

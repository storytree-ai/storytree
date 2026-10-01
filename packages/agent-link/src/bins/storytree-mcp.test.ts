/** Capability 6 · Agent tools: the built tool server, started the way Claude Code and Codex start it. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { removeTempDir } from "../testing/folders.js";
import { buildBins } from "./build.js";

test("6.33 the built storytree-mcp, started as a harness starts it, serves the tools over stdin and stdout and exits when stdin closes", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "storytree-mcp-"));
  t.after(() => removeTempDir(home));
  const bins = await buildBins(path.join(home, "bin"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bins["storytree-mcp"]!],
    cwd: home,
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", STORYTREE_HOME: home, HOME: home, USERPROFILE: home, CODEX_HOME: path.join(home, "codex"), CLAUDE_CONFIG_DIR: path.join(home, "claude") },
    stderr: "pipe",
  });
  const client = new Client({ name: "claude-code", version: "test" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.ok(tools.some((tool) => tool.name === "check_setup"), "the setup check is offered");
  const pid = transport.pid!;
  await client.close();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && alive(pid)) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(alive(pid), false, "the server exits once its stdin closes");
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

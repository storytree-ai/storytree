// codexwire.mjs <codexHome> <bins>: what `storytree setup connect --codex` writes into a Codex home.
import { appendFileSync } from "node:fs";
import { writeCodexInstructions } from "/home/mickh/code/storytree03/packages/agent-link/src/index.ts";
const [home, bins] = process.argv.slice(2);
appendFileSync(`${home}/config.toml`, `\n[mcp_servers.storytree]\ncommand = ${JSON.stringify(process.execPath)}\nargs = ${JSON.stringify([`${bins}/storytree-mcp.mjs`])}\nenv = { CODEX_HOME = ${JSON.stringify(home)} }\n`);
writeCodexInstructions(home);

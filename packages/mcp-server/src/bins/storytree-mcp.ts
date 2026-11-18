// Capability 6 · Tool server (the MCP server)
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createJourneyRuntime, journeyVersion } from "@storytree/app-setup/journey-events/runtime";

import { builtFromMain, runSetupCheck, type HookCommand } from "@storytree/app-setup/setup";
import { commandStep, createAgentTools } from "../tools/index.js";
import { shutdownOnce } from "./shutdown.js";

const folder = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const script = fileURLToPath(new URL("./storytree-hook.mjs", import.meta.url));
const checkout = fileURLToPath(new URL("../../../../", import.meta.url));
const hook: HookCommand | undefined = existsSync(script)
  ? { node: process.execPath, script }
  : await builtFromMain({ checkout }).catch(() => undefined);
const command = { path: process.env.PATH ?? process.env.Path ?? "", home: homedir() };
declare const STORYTREE_RELEASE: string | undefined;
const journey = createJourneyRuntime({ appVersion: journeyVersion(typeof STORYTREE_RELEASE === "string" ? STORYTREE_RELEASE : undefined) });
const cli = fileURLToPath(new URL("./storytree.mjs", import.meta.url));
const drain = commandStep(existsSync(cli)
  ? [process.execPath, cli]
  : [process.execPath, "--import", import.meta.resolve("tsx"), path.join(checkout, "packages", "cli", "src", "bins", "storytree.ts")], process.env);
const tools = createAgentTools({ folder, env: process.env, setup: hook === undefined ? {} : { hook, command }, journey, drain });
journey.start();

const stop = shutdownOnce({ input: process.stdin, work: () => [tools.close(), journey.finish()] });
process.stdin.on("close", stop);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);

await tools.server.connect(new StdioServerTransport());
void runSetupCheck({ folder, ...(hook === undefined ? {} : { hook, command }) }).catch(() => {
});

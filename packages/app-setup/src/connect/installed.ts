/** Capability 2 · Connect an agent. The installed helper joins delivery's saved paths to capability 2's connection operations. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { storytreeHome } from "@storytree/agent-link";
import { connectAgents, disconnectAgents, installedToolServerCommand, type Harness } from "./index.js";

/**
 * finish's record names the tools; before finish has run (the app never launched), the tools are the
 * ones installed beside this helper, which the installed command runs from its own folder.
 */
export function deliveredCommand(home = storytreeHome(), helperDir = path.dirname(process.argv[1] ?? "")) {
  const file = path.join(home, "delivery.json");
  if (!existsSync(file)) {
    const node = path.join(helperDir, process.platform === "win32" ? "node.exe" : "node");
    const mcp = path.join(helperDir, "storytree-mcp.mjs");
    if ([node, mcp].every((tool) => existsSync(tool))) return installedToolServerCommand(node, mcp);
    throw new Error(`No delivery record at ${file} and no installed tools beside this command in ${helperDir}. Re-run the storytree installer to the end: its finish step opens the app, puts the storytree command on PATH and records the tool paths. Then retry storytree setup connect --claude or --codex.`);
  }
  try {
    const record = JSON.parse(readFileSync(file, "utf8"));
    if (record?.schema !== 1 || typeof record.installDir !== "string" || !path.isAbsolute(record.installDir) ||
      typeof record.tools?.node !== "string" || typeof record.tools?.mcp !== "string") throw new Error("Invalid delivery record");
    return installedToolServerCommand(record.tools.node, record.tools.mcp);
  } catch {
    throw new Error(`Cannot read usable installed tool paths from ${file}. Re-run the storytree installer, then retry storytree setup connect --claude or --codex.`);
  }
}

const label = (harness: Harness) => harness === "claude-code" ? "Claude Code" : "Codex";

/** Output and exit status describe each agent independently; registration never attests hooks. */
export async function runInstalledConnection(action: "connect" | "disconnect", chosen: readonly string[]): Promise<string> {
  if (chosen.length === 0 || chosen.some((name) => name !== "claude-code" && name !== "codex")) {
    throw new Error("Choose claude-code, codex or both for connect; choose one for disconnect.");
  }
  if (action === "disconnect" && chosen.length !== 1) throw new Error("Disconnect one agent at a time: claude-code or codex.");
  const options = { harnesses: chosen as Harness[], installed: deliveredCommand() };
  if (action === "connect") {
    const results = await connectAgents(options);
    const text = results.map((result) => `${label(result.harness)}: tools ${result.tools}; hooks ${result.hooks}.\n${result.next}`).join("\n\n");
    if (results.some((result) => result.tools === "not connected")) throw new Error(text);
    return text;
  }
  const report = await disconnectAgents(options);
  const text = [...report.harnesses.map((result) => `${label(result.harness)}: tools ${result.tools}.\n${result.next}`), report.next].join("\n\n");
  if (report.harnesses.some((result) => result.tools === "kept")) throw new Error(text);
  return text;
}

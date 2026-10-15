/**
 * Capability 2 · Connect an agent. `storytree setup connect | disconnect | uninstall`: each runs the installed delivery
 * helper beside the command, which owns delivery paths and connection results.
 */
import { verb, VerbRefusal, type Verb, type VerbInputs } from "@storytree/library/verbs";

import type { SetupVerbContext } from "../verbs.js";

const NO_TOOL = { absent: "an agent is connected, and storytree uninstalled, by the person at this computer from a terminal" };
const AGENTS = { claude: "claude-code", codex: "codex", cursor: "cursor", pi: "pi", antigravity: "antigravity" } as const;
const HARNESSES: readonly string[] = Object.values(AGENTS);

/** Run the installed delivery helper beside the command with `args`, answering what it printed. */
async function installed(args: string[], context: SetupVerbContext): Promise<{ text: string }> {
  const { existsSync } = await import("node:fs");
  const path = await import("node:path");
  const script = context.script === undefined ? undefined : path.join(path.dirname(context.script), "storytree-deliver.mjs");
  if (script === undefined || !existsSync(script)) throw new VerbRefusal(`The installed setup helper is missing: only an installed storytree has it. Re-run the storytree installer, then run this installation's storytree setup ${args[0] === "open-uninstaller" ? "uninstall" : "connect"} command.`);
  const { spawnSync } = await import("node:child_process");
  const ran = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  if (ran.status !== 0) throw new VerbRefusal(`${ran.stderr ?? ""}${ran.stdout ?? ""}`.trim() || "The connection helper could not run. Re-run the storytree installer and retry.");
  return { text: ran.stdout };
}

const connect = verb({
  consumers: ["user"],
  command: { family: "setup", name: "connect", summary: "connect the installed tools to your chosen agents; hooks are checked in their next session" },
  tool: NO_TOOL,
  callerless: true,
  inputs: {
    claude: { kind: "switch", describe: "connect Claude Code" },
    codex: { kind: "switch", describe: "connect Codex" },
    cursor: { kind: "switch", describe: "connect Cursor" },
    pi: { kind: "switch", describe: "connect Pi" },
    antigravity: { kind: "switch", describe: "connect Antigravity CLI" },
  },
  async act(input, context: SetupVerbContext) {
    const chosen = (Object.keys(AGENTS) as (keyof typeof AGENTS)[]).filter((agent) => input[agent]);
    if (chosen.length === 0) throw new VerbRefusal("Choose --claude, --codex, --cursor, --pi, --antigravity or several.", { misuse: true });
    const answer = await installed(["connect", ...chosen.map((agent) => AGENTS[agent])], context);
    await context.journey?.().then((journey) => journey.agentConnected()).catch(() => {});
    return answer;
  },
});

const disconnect = verb({
  consumers: ["user"],
  command: { family: "setup", name: "disconnect", summary: "disconnect one agent while keeping other connections and your projects", usage: "setup disconnect <claude-code|codex|cursor|pi|antigravity>" },
  tool: NO_TOOL,
  callerless: true,
  inputs: { harness: { kind: "text", word: 0, describe: "the agent to disconnect: claude-code, codex, cursor, pi or antigravity" } },
  async act({ harness }, context: SetupVerbContext) {
    if (!HARNESSES.includes(harness)) throw new VerbRefusal(`${harness} is not an agent storytree connects`, { misuse: true });
    return installed(["disconnect", harness], context);
  },
});

const uninstall = verb({
  consumers: ["user"],
  command: {
    family: "setup", name: "uninstall", usage: "setup uninstall [--keep-library|--remove-library]",
    summary: "remove storytree from this computer, as Windows Apps & features does; your project folders are left alone",
  },
  tool: NO_TOOL,
  callerless: true,
  inputs: {
    "keep-library": { kind: "switch", describe: "keep the library" },
    "remove-library": { kind: "switch", describe: "remove the library" },
  },
  async act(input, context: SetupVerbContext) {
    const keep = input["keep-library"];
    const remove = input["remove-library"];
    if (keep && remove) throw new VerbRefusal("give --keep-library or --remove-library, not both (without either, the uninstaller asks)", { misuse: true });
    return installed(["open-uninstaller", ...(keep ? ["keep"] : remove ? ["remove"] : [])], context);
  },
});

export const CONNECTION_VERBS: readonly Verb<VerbInputs, SetupVerbContext>[] = [connect, disconnect, uninstall];

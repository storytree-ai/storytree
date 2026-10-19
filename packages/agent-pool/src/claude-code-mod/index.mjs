// Capability 6 · Loads in the runner's lanes and in interactive sessions. Where the mod's plugin folder is, for a host that loads it
// (`claude --plugin-dir <folder>`, or CLAUDE_CODE_PLUGIN_DIRS): in the checkout, so it follows main (ADR-1056 D3).
import { fileURLToPath } from "node:url";

/** The mod's plugin folder: `.claude-plugin/plugin.json`, and `hooks/hooks.json` naming its hooks module. */
export const PLUGIN_FOLDER = fileURLToPath(new URL("./plugin", import.meta.url));

/** The environment Claude Code needs to load a plugin's hooks module while they are early access (seen in 2.1.284). */
export const FUNCTION_HOOKS = { CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1" };

/** The variable naming the file the mod writes its session id in at start, which a Mint lane's runner reads (ADR-1056 D3). */
export const SESSION_FILE = "STORYTREE_SESSION_FILE";

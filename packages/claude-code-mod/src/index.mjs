// Capability 2 · Loads in the runner's lanes and in interactive sessions
import { fileURLToPath } from "node:url";

export const PLUGIN_FOLDER = fileURLToPath(new URL("./plugin", import.meta.url));

export const FUNCTION_HOOKS = { CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: "1" };

export const SESSION_FILE = "STORYTREE_SESSION_FILE";

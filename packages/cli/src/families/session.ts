/**
 * Capability 11 · Workspace. `storytree session list [--all] [--json]`: the running sessions, as the app's list shows them.
 * `storytree session close-out --safe yes|no --why <why>` (ADR-0758 D2): the calling agent session
 * records whether it is safe to close, and why. `storytree session name <title>` (contract 6.32): the
 * calling agent session names its row in the sessions list; the latest name shows. A front door only:
 * each is a session verb Session management declares once, mounted here as the MCP server mounts it (ADR-0969 D2).
 */
import { SESSION_VERBS } from "@storytree/session-management/verbs";

import type { Family } from "../door.js";
import { command } from "../mount.js";

export const session: Family = {
  name: "session",
  summary: "list the running sessions, name this one, or close it out (Session management's)",
  verbs: SESSION_VERBS.map(command),
};

// Capability 3 · Hooks
import type { ConnectOptions } from "@storytree/library";

import { withConnectTimeout } from "@storytree/project-and-caller";

import { AFTER_TOOL } from "./at-once.js";
import { TOOL_GRACE_MS } from "./codex-delivery.js";
import { EDIT_GATE } from "./edit-gate.js";
import { OBSERVE_STEP } from "./shell-edits.js";
import { SHELL_GUARD } from "./shell-guard.js";

export const DEADLINE_MS = 5_000;
export const GUARDED_DEADLINE_MS = 9_000;
export const REMOTE_DEADLINE_MS = 50_000;
export const UPKEEP_DEADLINE_MS = 20_000;

export function hookDeadline(flags: readonly string[], observeMs = OBSERVE_STEP.floorMs, remote = false): number {
  if (flags.includes(EDIT_GATE) || flags.includes(SHELL_GUARD)) return GUARDED_DEADLINE_MS;
  if (remote && flags.includes(AFTER_TOOL)) return REMOTE_DEADLINE_MS;
  const ordinary = DEADLINE_MS + Math.max(0, Math.min(observeMs, OBSERVE_STEP.ceilingMs) - OBSERVE_STEP.floorMs);
  return flags.includes(AFTER_TOOL) ? ordinary + TOOL_GRACE_MS : ordinary;
}

export function withDeadline(library: ConnectOptions, connectTimeoutMs: number, deadlineMs = DEADLINE_MS): ConnectOptions {
  return { ...withConnectTimeout(library, connectTimeoutMs), statementTimeoutMs: deadlineMs };
}

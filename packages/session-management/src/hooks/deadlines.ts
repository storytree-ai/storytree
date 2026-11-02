/**
 * Capability 3 · Hooks. How long a hook may run (capability 3 · Hooks), and how its connections to storytree keep to it.
 * The hook command ends itself at its deadline, whatever it is waiting on; a statement it left
 * running would run on in the server, holding its connection, after the hook had gone (seen on
 * storytree-pg on 2026-10-07: hooks' reads still running minutes after their process ended). So the
 * server ends each of a hook's statements by that deadline too.
 */
import type { ConnectOptions } from "@storytree/library";

import { withConnectTimeout } from "@storytree/project-and-caller";

import { AFTER_TOOL } from "./at-once.js";
import { TOOL_GRACE_MS } from "./codex-delivery.js";
import { EDIT_GATE } from "./edit-gate.js";
import { OBSERVE_STEP } from "./shell-edits.js";
import { SHELL_GUARD } from "./shell-guard.js";

/** The longest a hook may run, start to finish. Reaching storytree is given up well before this. */
export const DEADLINE_MS = 5_000;
/**
 * The longest the edit gate and the shell guard may run, whose limits this machine learns up to 8 s (ADR-1163 D2):
 * inside the 10 s Codex gives them, the most any harness storytree sets up gives a hook it waits on.
 */
export const GUARDED_DEADLINE_MS = 9_000;
/**
 * The longest a hook nothing waits for (`--after-tool`, Claude Code's async hooks) may run over a wss:// library, where
 * one hook's write takes about 20 s (remote-turn.ts): inside the 60 s Claude Code gives a hook before it stops it (ADR-1207 D1).
 */
export const REMOTE_DEADLINE_MS = 50_000;
/** The longest the look around the machine a hook hands on may run: asking GitHub alone may take 10 s. */
export const UPKEEP_DEADLINE_MS = 20_000;

/**
 * The longest a hook run with `flags` may run, the look around the machine apart (UPKEEP_DEADLINE_MS). One run `--after-tool` first waits up to TOOL_GRACE_MS for the tool
 * server's note of its event, so it is given that wait on top: without it, the copy a hook hands its line to was cut
 * off while it connected to a store slow to answer, and the line was lost rather than left waiting (seen on CI,
 * 2026-10-19). Nothing waits on such a hook, which is `async`, so the longer bound costs the agent nothing. An ordinary
 * hook is also given what this machine's shell-edit observation learned over its floor (`observeMs`, ADR-1163 D2):
 * the observation's Git reads run before anything else, and cannot be cut off mid-read. Over a wss:// library (`remote`) the
 * `--after-tool` hook is given REMOTE_DEADLINE_MS instead.
 */
export function hookDeadline(flags: readonly string[], observeMs = OBSERVE_STEP.floorMs, remote = false): number {
  if (flags.includes(EDIT_GATE) || flags.includes(SHELL_GUARD)) return GUARDED_DEADLINE_MS;
  if (remote && flags.includes(AFTER_TOOL)) return REMOTE_DEADLINE_MS;
  const ordinary = DEADLINE_MS + Math.max(0, Math.min(observeMs, OBSERVE_STEP.ceilingMs) - OBSERVE_STEP.floorMs);
  return flags.includes(AFTER_TOOL) ? ordinary + TOOL_GRACE_MS : ordinary;
}

/** `library` as a hook reaches it: each new handshake given up after `connectTimeoutMs`, and each statement ended by the server at `deadlineMs`. */
export function withDeadline(library: ConnectOptions, connectTimeoutMs: number, deadlineMs = DEADLINE_MS): ConnectOptions {
  return { ...withConnectTimeout(library, connectTimeoutMs), statementTimeoutMs: deadlineMs };
}

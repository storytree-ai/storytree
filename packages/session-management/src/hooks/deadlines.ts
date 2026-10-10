/**
 * Capability 3 · Hooks. How long a hook may run (capability 3 · Hooks), and how its connections to storytree keep to it.
 * The hook command ends itself at its deadline, whatever it is waiting on; a statement it left
 * running would run on in the server, holding its connection, after the hook had gone (seen on
 * storytree-pg on 2026-10-07: hooks' reads still running minutes after their process ended). So the
 * server ends each of a hook's statements by that deadline too.
 */
import type { ConnectOptions } from "@storytree/library";

import { withConnectTimeout } from "../routing/index.js";

/** The longest a hook may run, start to finish. Reaching storytree is given up well before this. */
export const DEADLINE_MS = 5_000;
/** The longest the look around the machine a hook hands on may run: asking GitHub alone may take 10 s. */
export const UPKEEP_DEADLINE_MS = 20_000;

/** `library` as a hook reaches it: each new handshake given up after `connectTimeoutMs`, and each statement ended by the server at `deadlineMs`. */
export function withDeadline(library: ConnectOptions, connectTimeoutMs: number, deadlineMs = DEADLINE_MS): ConnectOptions {
  return { ...withConnectTimeout(library, connectTimeoutMs), statementTimeoutMs: deadlineMs };
}

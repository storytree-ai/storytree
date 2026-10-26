/**
 * Capability 1 · Arm switch, as an arm check: Experiments contributes it through its manifest's `armChecks`, and the
 * command line and the MCP server run every arm check the parts they mount contribute, so neither door imports
 * Experiments for it, and with Experiments switched off no arm is enforced. The check's shape is the doors' declared
 * interface, restated rather than imported (ADR-1017 D2).
 */
import { verdictOf, type Verdict } from "./arms.js";

/** A check a door runs before a verb: whether `door` may run `verb` for a caller whose storytree home is `home`. */
export interface ArmCheck {
  readonly name: string;
  verdict(door: "tool" | "command", verb: string, home?: string): Verdict;
}

export const armChecks: readonly ArmCheck[] = [{ name: "experiment-arm", verdict: verdictOf }];

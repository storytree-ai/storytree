/**
 * Capability 3 · The check command. The `check` verb, declared here (ADR-0969 D2) and named under `verbs` in the
 * package's manifest (ADR-1033), so the command line mounts it as its `check` family: the package rule and the
 * allocation rule over the checkout the folder is in. It reads the checkout alone, so it is callerless and needs no
 * project, library or running app, and a user's CI can run it; a failure is refused with every problem named. It is no
 * tool: a user's CI runs it from a terminal.
 */
import { verb, VerbRefusal, type VerbFamily, type VerbPlace } from "@storytree/project-and-caller/verbs";

const check = verb<{}, VerbPlace>({
  command: { family: "check", name: "check", summary: "run storytree's package and allocation rules over this checkout; exits 1 when either is broken", usage: "check" },
  tool: { absent: "a user's CI runs the check from a terminal" },
  inputs: {},
  callerless: true,
  async act(_input, { folder }) {
    const { check, checkoutOf } = await import("../index.js");
    const report = await check(checkoutOf(folder));
    if (!report.passed) throw new VerbRefusal(report.text);
    return { text: report.text };
  },
});

/** The command line's `check` family, 9th among `storytree`'s families. */
export const CHECK_FAMILIES: readonly VerbFamily<VerbPlace>[] = [
  { name: "check", summary: "storytree's package and allocation rules, run over this checkout", order: 9, verbs: [], bare: check },
];

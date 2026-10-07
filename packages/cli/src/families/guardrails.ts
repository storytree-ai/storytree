/**
 * Capability 12 · Check (the command line story): `storytree check`, a terminal front door onto the
 * Guardrails story's check (ADR-0911 D2): the package rule and the allocation rule over the checkout
 * the folder is in. It reads the checkout alone, so it needs no project, library or running app, and a
 * user's CI can run it; a failure exits 1 with every problem named.
 */
import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

const checkVerb: Verb = {
  name: "check",
  usage: "check",
  summary: "run storytree's package and allocation rules over this checkout; exits 1 when either is broken",
  async act(_args, context) {
    const { check, checkoutOf } = await import("@storytree/guardrails");
    const report = await check(checkoutOf(context.cwd));
    if (!report.passed) throw new Refusal(report.text);
    return { text: report.text };
  },
};

export const checkFamily: Family = {
  name: "check",
  summary: "storytree's package and allocation rules, run over this checkout",
  verbs: [],
  bare: checkVerb,
};

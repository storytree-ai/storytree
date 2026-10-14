/**
 * Capability 1 · Quality control checks. The `quality` verbs, declared here (ADR-1033 D3) and named under `verbs` in the
 * package's manifest, so the command line mounts them as its `quality` family: the checks and ledger readings, the
 * change-reviewer's loop (brief, take, answer, standing) and graduating a check. A verb that reads or writes the QA ledger
 * needs the library server, and is refused where the door hands none. They are no tools: this package's tool parts serve
 * the same work on the MCP server, with the inputs a tool takes.
 */
import { verb, VerbRefusal, type VerbContext, type VerbFamily } from "@storytree/library/verbs";

/**
 * What the quality verbs read off the door beyond the caller: the activity log a review's claims are read from, in this
 * package's own copy of the field (ADR-1017 D2). Session management's reader takes it as its own type.
 */
interface QualityVerbContext extends VerbContext {
  readonly log: unknown;
}

const NO_TOOL = { absent: "this package's tool parts serve the same work on the MCP server (quality_checks and the rest)" };

/** The library server the QA ledger is kept on: a door that has none open cannot reach it. */
function server(context: VerbContext): NonNullable<VerbContext["server"]> {
  if (context.server === undefined) throw new VerbRefusal("the QA ledger is kept on the library server, which this door has not opened");
  return context.server;
}

const checksVerb = verb({
  command: { family: "quality", name: "checks", summary: "every live quality control check: its question and the notes it enforces" },
  tool: NO_TOOL,
  inputs: {},
  async act(_input, context: QualityVerbContext) {
    const { checks, checksText } = await import("../index.js");
    const reading = await checks(context.library);
    return {
      text: checksText(reading),
      ...(reading.length === 0 ? {} : { next: [{ command: "library read <check>", why: "read one check whole" }] }),
    };
  },
});

const ledgerVerb = verb({
  command: { family: "quality", name: "ledger", summary: "the QA ledger's counts: per check and package, the reviews that ran it and its hits by answer" },
  tool: NO_TOOL,
  inputs: {},
  async act(_input, context: QualityVerbContext) {
    const { ledgerText, openLedger } = await import("../index.js");
    return { text: ledgerText(await (await openLedger(server(context))).reading(context.library.name)) };
  },
});

const briefVerb = verb({
  command: { family: "quality", name: "brief", summary: "issue the next review's brief for an increment's change: the diff of the branch it was claimed on against origin/main (or the local default branch with none), its contracts and the checks", usage: "quality brief <increment> [--diff @file]" },
  tool: NO_TOOL,
  inputs: {
    increment: { kind: "text", word: 0, describe: "the increment whose change is reviewed" },
    diff: { kind: "text", optional: true, describe: "the change's diff against its default branch, as git diff gives it" },
  },
  async act({ increment, diff }, context: QualityVerbContext) {
    const { branchBase, branchDiff, briefText, changeFolder, openReviews } = await import("../index.js");
    const reviews = await openReviews(server(context));
    // The change is the branch the increment was claimed on, wherever this runs (contract 2.8).
    let folder = context.folder;
    if (diff === undefined) {
      const { readClaims } = await import("@storytree/session-management");
      folder = changeFolder(context.folder, (await readClaims(context.log as Parameters<typeof readClaims>[0], context.project)).find((claim) => claim.increment === increment)?.branch);
    }
    const brief = await reviews.brief(context.library, increment, diff ?? branchDiff(folder), diff === undefined ? branchBase(folder) : undefined);
    return {
      text: briefText(brief),
      next: [{ command: `quality take ${increment} --return @<file>`, why: "record the review's return, as JSON" }],
    };
  },
});

const takeVerb = verb({
  command: { family: "quality", name: "take", summary: "take the change-reviewer's return on the increment's brief into the QA ledger, or refuse it naming what it leaves out", usage: "quality take <increment> --return @file" },
  tool: NO_TOOL,
  inputs: {
    increment: { kind: "text", word: 0, describe: "the increment whose change was reviewed" },
    return: { kind: "text", describe: "the change-reviewer's return, as JSON" },
  },
  async act({ increment, return: text }, context: QualityVerbContext) {
    const { graduatedFindings, openReviews, takenText } = await import("../index.js");
    let review;
    try {
      review = JSON.parse(text);
    } catch (error) {
      throw new VerbRefusal(`the return is not JSON: ${(error as Error).message}`);
    }
    const reviews = await openReviews(server(context));
    const taken = await reviews.take(context.library.name, increment, review, await graduatedFindings(context.library, context.folder));
    return {
      text: takenText(taken),
      ...(taken.standing.length === 0 ? {} : { next: [{ command: "quality answer <hit> fixed|rejected --reason …", why: "answer each standing finding" }] }),
    };
  },
});

const answerVerb = verb({
  command: { family: "quality", name: "answer", summary: "the implementer's answer to a hit: fixed, or rejected with a reason", usage: "quality answer <hit> fixed|rejected [--reason …]" },
  tool: NO_TOOL,
  inputs: {
    hit: { kind: "text", word: 0, describe: "the hit, by its number" },
    how: { kind: "text", word: 1, describe: "fixed or rejected" },
    reason: { kind: "text", optional: true, describe: "why the hit is rejected; needed for a rejection" },
  },
  async act({ hit: word, how, reason }, context: QualityVerbContext) {
    const hit = Number(word);
    if (!Number.isInteger(hit)) throw new VerbRefusal("a hit is named by its number", { misuse: true });
    if (how !== "fixed" && how !== "rejected") throw new VerbRefusal(`a hit is answered fixed or rejected, not ${how}`, { misuse: true });
    if (how === "rejected" && reason === undefined) throw new VerbRefusal("this needs --reason: why the hit is rejected", { misuse: true });
    const { openLedger } = await import("../index.js");
    await (await openLedger(server(context))).answer(context.library.name, hit, how === "fixed" ? { answer: "fixed" } : { answer: "rejected", reason: reason! });
    return { text: `Answered hit ${hit}: ${how}.` };
  },
});

const standingVerb = verb({
  command: { family: "quality", name: "standing", summary: "the findings that still stand on an increment's change, or that it is ready for the gate" },
  tool: NO_TOOL,
  inputs: { increment: { kind: "text", word: 0, describe: "the increment whose change is reviewed" } },
  async act({ increment }, context: QualityVerbContext) {
    const { openReviews, standingText } = await import("../index.js");
    return { text: standingText(await (await openReviews(server(context))).standing(context.library.name, increment)) };
  },
});

const graduateVerb = verb({
  command: { family: "quality", name: "graduate", summary: "record that a part of a check, or with --whole all of it, is now enforced by a deterministic check in Guardrails", usage: "quality graduate <check> --part … --enforced-by <guardrails check> [--whole]" },
  tool: NO_TOOL,
  inputs: {
    check: { kind: "text", word: 0, describe: "the check that graduates" },
    part: { kind: "text", describe: "the part of the check Guardrails now enforces" },
    "enforced-by": { kind: "text", describe: "the Guardrails graduated check that enforces it" },
    whole: { kind: "switch", describe: "the part is all of the check, so it leaves the review brief" },
  },
  async act({ check, part, "enforced-by": enforcedBy, whole }, context: QualityVerbContext) {
    const { checks, checksText, graduate } = await import("../index.js");
    await graduate(context.library, check, { part, enforcedBy, ...(whole ? { whole: true as const } : {}) });
    return { text: `Graduated ${whole ? "all" : "part"} of ${check}.\n${checksText((await checks(context.library)).filter(({ id }) => id === check))}` };
  },
});

/** The command line's `quality` family, 10th among `storytree`'s families. */
export const QUALITY_FAMILIES: readonly VerbFamily<QualityVerbContext>[] = [{
  name: "quality",
  summary: "the quality control checks, the QA ledger, the change-reviewer's loop (brief, take, answer, standing), and graduating a check",
  order: 10,
  verbs: [checksVerb, ledgerVerb, briefVerb, takeVerb, answerVerb, standingVerb, graduateVerb],
}];

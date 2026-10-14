/**
 * Capability 1 · Quality control checks; capability 2 · Change review; capability 3 · QA ledger; capability 5 ·
 * Graduation. The `quality` verbs, declared here (ADR-0969 D2) and named under `verbs` in the package's manifest
 * (ADR-1033), so the command line mounts them as its `quality` family: the checks and ledger readings, the same as this
 * package's tools give (contracts 1.2 and 3.4), the change-reviewer's loop, the brief (of the branch its increment was
 * claimed on, contract 2.8), the return taken, the implementer's answer and what still stands, with what Guardrails'
 * graduated checks find on the change taken beside the return, and a check graduated to them. None is a tool here: the
 * MCP server mounts this package's own tools (`qualityToolParts`).
 */
import { verb, VerbRefusal, type VerbContext, type VerbFamily } from "@storytree/project-and-caller/verbs";
import type { SessionVerbContext } from "@storytree/session-management/verbs";

const ABSENT = { absent: "the MCP server mounts this package's own tools (qualityToolParts)" };

/** The library server the ledger keeps its own database on, or a refusal when the door hands none. */
function serverOf(context: VerbContext): NonNullable<VerbContext["server"]> {
  if (context.server === undefined) throw new VerbRefusal("the QA ledger needs the library server, and this door handed none");
  return context.server;
}

const checksVerb = verb<{}, VerbContext>({
  command: { family: "quality", name: "checks", summary: "every live quality control check: its question and the notes it enforces", usage: "quality checks" },
  tool: ABSENT,
  inputs: {},
  async act(_input, { library }) {
    const { checks, checksText } = await import("./index.js");
    const reading = await checks(library);
    return {
      text: checksText(reading),
      ...(reading.length === 0 ? {} : { next: [{ command: "library read <check>", why: "read one check whole" }] }),
    };
  },
});

const ledgerVerb = verb<{}, VerbContext>({
  command: { family: "quality", name: "ledger", summary: "the QA ledger's counts: per check and package, the reviews that ran it and its hits by answer", usage: "quality ledger" },
  tool: ABSENT,
  inputs: {},
  async act(_input, context) {
    const { ledgerText, openLedger } = await import("./index.js");
    return { text: ledgerText(await (await openLedger(serverOf(context))).reading(context.library.name)) };
  },
});

const brief = verb({
  command: { family: "quality", name: "brief", summary: "issue the next review's brief for an increment's change: the diff of the branch it was claimed on against origin/main (or the local default branch with none), its contracts and the checks", usage: "quality brief <increment> [--diff @file]" },
  tool: ABSENT,
  inputs: {
    increment: { kind: "text", describe: "the increment whose change is reviewed", word: 0 },
    diff: { kind: "text", describe: "the change's diff, in place of its branch's", optional: true },
  },
  async act({ increment, diff }, context: SessionVerbContext) {
    const { branchBase, branchDiff, briefText, changeFolder, openReviews } = await import("./index.js");
    // The change is the branch the increment was claimed on, wherever this runs (contract 2.8).
    let folder = context.folder;
    if (diff === undefined) {
      const { readClaims } = await import("@storytree/session-management");
      folder = changeFolder(context.folder, (await readClaims(context.log, context.project)).find((claim) => claim.increment === increment)?.branch);
    }
    const made = await (await openReviews(serverOf(context))).brief(context.library, increment, diff ?? branchDiff(folder), diff === undefined ? branchBase(folder) : undefined);
    return {
      text: briefText(made),
      next: [{ command: `quality take ${increment} --return @<file>`, why: "record the review's return, as JSON" }],
    };
  },
});

const take = verb({
  command: { family: "quality", name: "take", summary: "take the change-reviewer's return on the increment's brief into the QA ledger, or refuse it naming what it leaves out", usage: "quality take <increment> --return @file" },
  tool: ABSENT,
  inputs: {
    increment: { kind: "text", describe: "the increment whose change was reviewed", word: 0 },
    return: { kind: "text", describe: "the review's return, as JSON" },
  },
  async act({ increment, return: text }, context: VerbContext) {
    const { graduatedFindings, openReviews, takenText } = await import("./index.js");
    let review;
    try {
      review = JSON.parse(text);
    } catch (error) {
      throw new VerbRefusal(`the return is not JSON: ${(error as Error).message}`);
    }
    const taken = await (await openReviews(serverOf(context))).take(context.library.name, increment, review, await graduatedFindings(context.library, context.folder));
    return {
      text: takenText(taken),
      ...(taken.standing.length === 0 ? {} : { next: [{ command: "quality answer <hit> fixed|rejected --reason …", why: "answer each standing finding" }] }),
    };
  },
});

const answer = verb({
  command: { family: "quality", name: "answer", summary: "the implementer's answer to a hit: fixed, or rejected with a reason", usage: "quality answer <hit> fixed|rejected [--reason …]" },
  tool: ABSENT,
  inputs: {
    hit: { kind: "text", describe: "the hit", word: 0 },
    how: { kind: "text", describe: "fixed or rejected", word: 1 },
    reason: { kind: "text", describe: "why the hit is rejected", optional: true },
  },
  async act({ hit: word, how, reason }, context: VerbContext) {
    const { openLedger } = await import("./index.js");
    const hit = Number(word);
    if (!Number.isInteger(hit)) throw new VerbRefusal("a hit is named by its number", { misuse: true });
    if (how !== "fixed" && how !== "rejected") throw new VerbRefusal(`a hit is answered fixed or rejected, not ${how}`, { misuse: true });
    if (how === "rejected" && reason === undefined) throw new VerbRefusal("this needs --reason", { misuse: true });
    await (await openLedger(serverOf(context))).answer(context.library.name, hit, how === "fixed" ? { answer: "fixed" } : { answer: "rejected", reason: reason! });
    return { text: `Answered hit ${hit}: ${how}.` };
  },
});

const standing = verb({
  command: { family: "quality", name: "standing", summary: "the findings that still stand on an increment's change, or that it is ready for the gate", usage: "quality standing <increment>" },
  tool: ABSENT,
  inputs: { increment: { kind: "text", describe: "the increment whose change is reviewed", word: 0 } },
  async act({ increment }, context: VerbContext) {
    const { openReviews, standingText } = await import("./index.js");
    return { text: standingText(await (await openReviews(serverOf(context))).standing(context.library.name, increment)) };
  },
});

const graduate = verb({
  command: { family: "quality", name: "graduate", summary: "record that a part of a check, or with --whole all of it, is now enforced by a deterministic check in Guardrails", usage: "quality graduate <check> --part … --enforced-by <guardrails check> [--whole]" },
  tool: ABSENT,
  inputs: {
    check: { kind: "text", describe: "the check that graduates", word: 0 },
    part: { kind: "text", describe: "the part of the check now enforced" },
    "enforced-by": { kind: "text", describe: "the Guardrails check that enforces it" },
    whole: { kind: "switch", describe: "all of the check graduates" },
  },
  async act({ check, part, "enforced-by": enforcedBy, whole }, { library }: VerbContext) {
    const { checks, checksText, graduate } = await import("./index.js");
    await graduate(library, check, { part, enforcedBy, ...(whole ? { whole: true as const } : {}) });
    return { text: `Graduated ${whole ? "all" : "part"} of ${check}.\n${checksText((await checks(library)).filter(({ id }) => id === check))}` };
  },
});

/** The command line's `quality` family, 10th among `storytree`'s families. */
export const QUALITY_FAMILIES: readonly VerbFamily<SessionVerbContext>[] = [
  {
    name: "quality",
    summary: "the quality control checks, the QA ledger, the change-reviewer's loop (brief, take, answer, standing), and graduating a check",
    order: 10,
    verbs: [checksVerb, ledgerVerb, brief, take, answer, standing, graduate],
  },
];

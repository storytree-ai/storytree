/**
 * Capability 1 · Front door. `storytree quality …`: the quality assurance story's work (ADR-0956), its
 * checks and ledger readings the same as its tools on the MCP server give (that story's contracts 1.2 and 3.4),
 * and the change-reviewer's loop: the brief, the return taken, the implementer's answer and what still stands
 * (its capabilities 2 and 4).
 */
import { Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";

const checksVerb: Verb = {
  name: "checks",
  usage: "quality checks",
  summary: "every live quality control check: its question and the notes it enforces",
  async act(_args, context) {
    const { checks, checksText } = await import("@storytree/quality-assurance");
    const reading = await checks(await context.library());
    return {
      text: checksText(reading),
      ...(reading.length === 0 ? {} : { next: [{ command: "storytree library read <check>", why: "read one check whole" }] }),
    };
  },
};

const ledgerVerb: Verb = {
  name: "ledger",
  usage: "quality ledger",
  summary: "the QA ledger's counts: per check and package, the reviews that ran it and its hits by answer",
  async act(_args, context) {
    const { ledgerText, openLedger } = await import("@storytree/quality-assurance");
    const library = await context.library();
    return { text: ledgerText(await (await openLedger(await context.server())).reading(library.name)) };
  },
};

const briefUsage = "quality brief <increment> [--diff @file]";
const briefVerb: Verb = {
  name: "brief",
  usage: briefUsage,
  summary: "issue the next review's brief for an increment's change: its diff against origin/main, its contracts and the checks",
  async act(args, context) {
    const { branchDiff, briefText, openReviews } = await import("@storytree/quality-assurance");
    const increment = args.word(0, "the increment whose change is reviewed", briefUsage);
    const library = await context.library();
    const brief = await (await openReviews(await context.server())).brief(library, increment, args.text("diff") ?? branchDiff(context.cwd));
    return {
      text: briefText(brief),
      next: [{ command: `storytree quality take ${increment} --return @<file>`, why: "record the review's return, as JSON" }],
    };
  },
};

const takeUsage = "quality take <increment> --return @file";
const takeVerb: Verb = {
  name: "take",
  usage: takeUsage,
  summary: "take the change-reviewer's return on the increment's brief into the QA ledger, or refuse it naming what it leaves out",
  async act(args, context) {
    const { openReviews, takenText } = await import("@storytree/quality-assurance");
    const increment = args.word(0, "the increment whose change was reviewed", takeUsage);
    const text = args.need("return", takeUsage);
    let review;
    try {
      review = JSON.parse(text);
    } catch (error) {
      throw new Refusal(`the return is not JSON: ${(error as Error).message}`);
    }
    const library = await context.library();
    const taken = await (await openReviews(await context.server())).take(library.name, increment, review);
    return {
      text: takenText(taken),
      ...(taken.standing.length === 0 ? {} : { next: [{ command: "storytree quality answer <hit> fixed|rejected --reason …", why: "answer each standing finding" }] }),
    };
  },
};

const answerUsage = "quality answer <hit> fixed|rejected [--reason …]";
const answerVerb: Verb = {
  name: "answer",
  usage: answerUsage,
  summary: "the implementer's answer to a hit: fixed, or rejected with a reason",
  async act(args, context) {
    const { openLedger } = await import("@storytree/quality-assurance");
    const hit = Number(args.word(0, "the hit", answerUsage));
    if (!Number.isInteger(hit)) throw new Refusal(`a hit is named by its number\nusage: storytree ${answerUsage}`, { code: 2 });
    const how = args.word(1, "fixed or rejected", answerUsage);
    if (how !== "fixed" && how !== "rejected") throw new Refusal(`a hit is answered fixed or rejected, not ${how}\nusage: storytree ${answerUsage}`, { code: 2 });
    const library = await context.library();
    await (await openLedger(await context.server())).answer(library.name, hit, how === "fixed" ? { answer: "fixed" } : { answer: "rejected", reason: args.need("reason", answerUsage) });
    return { text: `Answered hit ${hit}: ${how}.` };
  },
};

const standingUsage = "quality standing <increment>";
const standingVerb: Verb = {
  name: "standing",
  usage: standingUsage,
  summary: "the findings that still stand on an increment's change, or that it is ready for the gate",
  async act(args, context) {
    const { openReviews, standingText } = await import("@storytree/quality-assurance");
    const increment = args.word(0, "the increment whose change is reviewed", standingUsage);
    const library = await context.library();
    return { text: standingText(await (await openReviews(await context.server())).standing(library.name, increment)) };
  },
};

export const quality: Family = {
  name: "quality",
  summary: "the quality control checks, the QA ledger, and the change-reviewer's loop: brief, take, answer, standing",
  verbs: [checksVerb, ledgerVerb, briefVerb, takeVerb, answerVerb, standingVerb],
};

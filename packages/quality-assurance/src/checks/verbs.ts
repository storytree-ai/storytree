/**
 * Capability 1 · Quality control checks. The `quality` verbs, declared here (ADR-1033 D3) and named under `verbs` in the
 * package's manifest, so the command line mounts them as its `quality` family: the checks and ledger readings, the
 * change-reviewer's loop (brief, take, answer, standing) and graduating a check. A verb that reads or writes the QA ledger
 * needs the library server, and is refused where the door hands none. They are no tools: this package's tool parts serve
 * the same work on the MCP server, with the inputs a tool takes.
 */
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

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
  consumers: ["agent"],
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
  consumers: ["agent"],
  command: { family: "quality", name: "ledger", summary: "the QA ledger's counts: per check and package, the reviews that ran it and its hits by answer" },
  tool: NO_TOOL,
  inputs: {},
  async act(_input, context: QualityVerbContext) {
    const { ledgerText, openLedger } = await import("../index.js");
    return { text: ledgerText(await (await openLedger(server(context))).reading(context.library.name)) };
  },
});

const briefVerb = verb({
  consumers: ["agent"],
  command: { family: "quality", name: "brief", summary: "issue the next review's brief for an increment's change: the diff of the branch it was claimed on against origin/main (or the local default branch with none), or of the branch in a checkout named outside the project, with each other half's in a checkout named by --also, its contracts and the checks", usage: "quality brief <increment> [--diff @file | --checkout <folder>] [--also <folder> …]" },
  tool: NO_TOOL,
  inputs: {
    increment: { kind: "text", word: 0, describe: "the increment whose change is reviewed" },
    diff: { kind: "text", optional: true, describe: "the change's diff against its default branch, as git diff gives it" },
    checkout: { kind: "text", optional: true, describe: "a checkout outside the project whose branch is the change, as the owner's factory repo is" },
    also: { kind: "text", many: true, optional: true, describe: "a checkout outside the project whose branch is the change's other half, given once for each: its diff is listed beside the change's" },
  },
  async act({ increment, diff, checkout, also }, context: QualityVerbContext) {
    if (diff !== undefined && checkout !== undefined) throw new VerbRefusal("give the change's diff or its checkout, not both", { misuse: true });
    const { briefWithReport, changeFolder, factoryPlugins, openReviews, worktreeChange } = await import("../index.js");
    const reviews = await openReviews(server(context));
    // The change is the branch the increment was claimed on, wherever this runs (contract 2.8), or the one in the checkout named (2.16).
    let folder = checkout === undefined ? context.folder : resolve(context.folder, checkout);
    if (diff === undefined && checkout === undefined) {
      const { readClaims } = await import("@storytree/session-management");
      folder = changeFolder(context.folder, (await readClaims(context.log as Parameters<typeof readClaims>[0], context.project)).find((claim) => claim.increment === increment)?.branch);
    }
    // A factory plugin's change is read from the factory repo, the checkout named or this computer's factory folder (contract 2.18).
    const factory = checkout === undefined ? (await import("@storytree/project-and-caller")).factoryFolder().folder : folder;
    // An increment landing in two repositories is reviewed whole: each other half's branch is listed beside the change (contract 2.19).
    const halves = (also ?? []).map((other) => worktreeChange(resolve(context.folder, other)));
    const brief = await reviews.brief(context.library, increment, diff ?? worktreeChange(folder), undefined, factoryPlugins(factory, increment), halves);
    // The change's mutation report runs on its worktree, never on a diff given by hand (contract 7.3).
    const { text } = await briefWithReport(server(context), brief, diff === undefined ? folder : undefined);
    return {
      text,
      next: [{ command: `quality take ${increment} --return @<file>`, why: "record the review's return, as JSON" }],
    };
  },
});

const takeVerb = verb({
  consumers: ["agent"],
  command: { family: "quality", name: "take", summary: "take the change-reviewer's return on the increment's brief into the QA ledger, or refuse it naming what it leaves out", usage: "quality take <increment> --return @file [--checkout <folder>] [--also <folder> …]" },
  tool: NO_TOOL,
  inputs: {
    increment: { kind: "text", word: 0, describe: "the increment whose change was reviewed" },
    return: { kind: "text", describe: "the change-reviewer's return, as JSON" },
    checkout: { kind: "text", optional: true, describe: "the checkout outside the project the brief read the change from, for Architecture checks' graduated checks to run on" },
    also: { kind: "text", many: true, optional: true, describe: "a checkout the brief read the change's other half from, given once for each, for the graduated checks to run on too" },
  },
  async act({ increment, return: text, checkout, also }, context: QualityVerbContext) {
    const { graduatedFindings, openReviews, takenText, takenWithSurvivors } = await import("../index.js");
    let review;
    try {
      review = JSON.parse(text);
    } catch (error) {
      throw new VerbRefusal(`the return is not JSON: ${(error as Error).message}`);
    }
    const reviews = await openReviews(server(context));
    const taken = await takenWithSurvivors(server(context), reviews, context.library.name, increment, await reviews.take(context.library.name, increment, review, await graduatedFindings(context.library, checkout === undefined ? context.folder : resolve(context.folder, checkout), (also ?? []).map((other) => resolve(context.folder, other)))));
    return {
      text: takenText(taken),
      ...(taken.standing.length === 0 ? {} : { next: [{ command: "quality answer <hit> fixed|rejected --reason …", why: "answer each standing finding" }] }),
    };
  },
});

const answerVerb = verb({
  consumers: ["agent"],
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
  consumers: ["agent"],
  command: { family: "quality", name: "standing", summary: "the findings that still stand on an increment's change, or that it is ready for the gate" },
  tool: NO_TOOL,
  inputs: { increment: { kind: "text", word: 0, describe: "the increment whose change is reviewed" } },
  async act({ increment }, context: QualityVerbContext) {
    const { openReviews, standingText } = await import("../index.js");
    const reviews = await openReviews(server(context));
    const project = context.library.name;
    return { text: standingText(await reviews.standing(project, increment), await reviews.unmet(context.library, increment), await reviews.failed(project, increment)) };
  },
});

const graduateVerb = verb({
  consumers: ["agent"],
  command: { family: "quality", name: "graduate", summary: "record that a part of a check, or with --whole all of it, is now enforced by a deterministic check in Architecture checks", usage: "quality graduate <check> --part … --enforced-by <guardrails check> [--whole]" },
  tool: NO_TOOL,
  inputs: {
    check: { kind: "text", word: 0, describe: "the check that graduates" },
    part: { kind: "text", describe: "the part of the check Architecture checks now enforces" },
    "enforced-by": { kind: "text", describe: "the graduated check in Architecture checks that enforces it" },
    whole: { kind: "switch", describe: "the part is all of the check, so it leaves the review brief" },
  },
  async act({ check, part, "enforced-by": enforcedBy, whole }, context: QualityVerbContext) {
    const { checks, checksText, graduate } = await import("../index.js");
    await graduate(context.library, check, { part, enforcedBy, ...(whole ? { whole: true as const } : {}) });
    return { text: `Graduated ${whole ? "all" : "part"} of ${check}.\n${checksText((await checks(context.library)).filter(({ id }) => id === check))}` };
  },
});

const riskVerb = verb({
  consumers: ["agent"],
  command: { family: "quality", name: "risk", summary: "read an increment's change for its risk line (tier, rating, depth, radius, flags, stories) and write it on the increment", usage: "quality risk <increment> [--diff @file]" },
  tool: NO_TOOL,
  writes: true,
  inputs: {
    increment: { kind: "text", word: 0, describe: "the increment whose change is read" },
    diff: { kind: "text", optional: true, describe: "the change's diff against its default branch, as git diff gives it" },
  },
  async act({ increment, diff }, context: QualityVerbContext) {
    const { branchDiff, changeFolder, PackageGraph, readChange, readPackages, riskLineText } = await import("../index.js");
    let folder = context.folder;
    if (diff === undefined && context.log !== undefined) {
      const { readClaims } = await import("@storytree/session-management");
      folder = changeFolder(context.folder, (await readClaims(context.log as Parameters<typeof readClaims>[0], context.project)).find((claim) => claim.increment === increment)?.branch);
    }
    const stories = (await context.library.list("story")).filter((story) => story.fields.mapped === undefined).map((story) => ({ id: story.id, title: story.fields.title }));
    const line = readChange(diff ?? branchDiff(folder), new PackageGraph(readPackages(folder)), stories, today());
    if ((await context.library.editIncrement(increment, { risk: line }, context.writer)) === null) throw new VerbRefusal(`no increment "${increment}" in this project`);
    return { text: `Wrote ${increment}'s risk line: ${riskLineText(line)}` };
  },
});

const storyRisksVerb = verb({
  consumers: ["agent"],
  command: { family: "quality", name: "story-risks", summary: "read every story's standing risk reading (blast depth and radius) from its package's code and the package graph, and write it on the story" },
  tool: NO_TOOL,
  writes: true,
  inputs: {},
  async act(_input, context: QualityVerbContext) {
    const { checkoutSource, PackageGraph, readPackages, readStory } = await import("../index.js");
    const graph = new PackageGraph(readPackages(context.folder));
    const source = checkoutSource(context.folder);
    const read = today();
    const lines: string[] = [];
    let unchanged = 0;
    for (const story of await context.library.list("story")) {
      if (story.fields.mapped !== undefined) continue;
      const reading = readStory({ id: story.id, title: story.fields.title }, graph, source, read);
      if (reading === undefined) continue;
      // A reading the same as the stored one in all but its day is not written again, so history keeps only real changes.
      if (story.fields.risk !== undefined && isDeepStrictEqual(undated(story.fields.risk), undated(reading))) unchanged++;
      else await context.library.editStory(story.id, { risk: reading }, context.writer);
      lines.push(`  ${story.id}  ${story.fields.title}: ${2 * reading.depth.value + reading.radius.value} · depth ${reading.depth.value} (${reading.depth.reason}) · radius ${reading.radius.value} (${reading.radius.reason})`);
    }
    return { text: lines.length === 0 ? "No story has a package in this checkout to read." : [`Wrote ${lines.length - unchanged} stories' risk readings${unchanged === 0 ? "" : `, ${unchanged} unchanged`}:`, ...lines].join("\n") };
  },
});

/** A story's risk reading as stored, without the days it was read, to compare two readings by what they say. */
function undated(reading: { readonly depth: object; readonly radius: object }): unknown {
  return JSON.parse(JSON.stringify({ depth: { ...reading.depth, read: undefined }, radius: { ...reading.radius, read: undefined } }));
}

/** Today, as a reading's day (YYYY-MM-DD). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The command line's `quality` family, 10th among `storytree`'s families. */
export const QUALITY_FAMILIES: readonly VerbFamily<QualityVerbContext>[] = [{
  name: "quality",
  summary: "the quality control checks, the QA ledger, the change-reviewer's loop (brief, take, answer, standing), graduating a check, and the risk reading",
  order: 10,
  verbs: [checksVerb, ledgerVerb, briefVerb, takeVerb, answerVerb, standingVerb, graduateVerb, riskVerb, storyRisksVerb],
}];

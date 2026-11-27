// Capability 13 · Decision log
import { refusing, verb, VerbRefusal, type VerbAnswer, type VerbContext } from "../../commands/kit/index.js";
import type { DecisionLinkCounts } from "./links.js";
import { adr } from "./numbering.js";

const COUNTED = ["pruned", "restored", "justified", "corrected", "added", "decisions"] as const;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function countsSaid(counts: DecisionLinkCounts): string {
  return COUNTED.map((name) => `${name} ${counts[name]}`).join("  ");
}

export const MOVE_NARROWS = verb({
  command: { family: "adr", name: "move-narrows", summary: "move every stored narrows onto supersedesClauses (ADR-1379 D1)", usage: "adr move-narrows" },
  tool: { absent: "narrows are moved on the command line" },
  inputs: {},
  writes: true,
  async act(_input, context: VerbContext): Promise<VerbAnswer> {
    const { decisions, edges, partial } = await refusing(() => context.library.moveNarrowsToClauses(context.writer));
    if (decisions.length === 0) return { text: "No decision stores a narrows: nothing was moved." };
    return { text: `Moved the narrows of ${plural(decisions.length, "decision", "decisions")} onto ${plural(edges, "supersedesClauses entry", "supersedesClauses entries")}, ${partial} partial.`, data: { decisions } };
  },
});

export const PAIRS = verb({
  command: { family: "adr", name: "pairs", summary: "check each clause-scoped supersedes has its in-place note, and each in-place note its edge", usage: "adr pairs" },
  tool: { absent: "supersession pairs are checked on the command line" },
  inputs: {},
  async act(_input, context: VerbContext): Promise<VerbAnswer> {
    const { flagged, backlog } = await context.library.supersessionPairs();
    const counted = `${plural(backlog, "pair", "pairs")} from before 2026-11-20 counted as backlog`;
    if (flagged.length === 0) return { text: `Every clause-scoped supersedes has its in-place note, and every note its edge; ${counted}.` };
    const lines = flagged.map(({ kind, from, to }) => (kind === "no-note" ? `  ${from} supersedes clauses of ${to}, which holds no in-place note naming it` : `  ${to} holds an in-place note naming ${from}, with no supersedes edge behind it`));
    throw new VerbRefusal([`${plural(flagged.length, "supersession pair is", "supersession pairs are")} flagged (${counted}):`, ...lines].join("\n"));
  },
});

export const BACKLOG = verb({
  command: { family: "adr", name: "backlog", summary: "count the old-shape decision links, stored with no justification (ADR-1379 D2)", usage: "adr backlog [--by-target]" },
  tool: { absent: "the decision link backlog is read on the command line" },
  inputs: { "by-target": { kind: "switch", describe: "List each decision old-shape links point at, most links in first" } },
  async act(input, context: VerbContext): Promise<VerbAnswer> {
    const { links, decisions, targets } = await context.library.decisionLinkBacklog();
    if (input["by-target"] !== true) return { text: `${plural(links, "old-shape decision link", "old-shape decision links")} (no justification) across ${plural(decisions, "decision", "decisions")}` };
    if (targets.length === 0) return { text: "No old-shape decision link is left." };
    return { text: targets.map(({ number, title, links: count }) => `${number === undefined ? "(no number)" : adr(number)}  ${title}  ${plural(count, "old-shape link", "old-shape links")} in`).join("\n") };
  },
});

export const CHANGES = verb({
  command: { family: "adr", name: "changes", summary: "count, per UTC day and in total, the decision links pruned, restored, justified, corrected and added", usage: "adr changes [--from <day>] [--to <day>] [--by <writer>]" },
  tool: { absent: "decision link changes are counted on the command line" },
  inputs: {
    from: { kind: "text", optional: true, describe: "The first UTC day counted, YYYY-MM-DD" },
    to: { kind: "text", optional: true, describe: "The last UTC day counted, YYYY-MM-DD" },
    by: { kind: "text", optional: true, describe: "Count only this writer's writes" },
  },
  async act({ from, to, by }, context: VerbContext): Promise<VerbAnswer> {
    const { days, total } = await context.library.decisionLinkChanges({ from, to, by });
    if (days.length === 0) return { text: `No decision link changed from ${from ?? "the first day"} to ${to ?? "today"}${by === undefined ? "" : ` by ${by}`}.` };
    return { text: [...days.map((day) => `${day.day}  ${countsSaid(day)}`), `total  ${countsSaid(total)}`].join("\n") };
  },
});

export const PRUNE = verb({
  command: { family: "adr", name: "prune", summary: "move a decision's link into its archive, with who, when and why", usage: "adr prune <decision> <target> --reason <why>" },
  tool: { absent: "decision links are pruned on the command line" },
  inputs: {
    decision: { kind: "text", word: 0, describe: "The decision holding the link" },
    target: { kind: "text", word: 1, describe: "The record it links to" },
    reason: { kind: "text", optional: true, describe: "Why the link is pruned" },
  },
  writes: true,
  async act({ decision, target, reason }, context: VerbContext): Promise<VerbAnswer> {
    if (reason === undefined || reason.trim() === "") throw new VerbRefusal("adr prune archives a link with the reason it was pruned: give --reason <why>; nothing was written", { misuse: true });
    await refusing(() => context.library.pruneLink(decision, target, reason, context.writer));
    return { text: `Pruned ${decision}'s link to ${target} into its archive.` };
  },
});

export const PRUNED = verb({
  command: { family: "adr", name: "pruned", summary: "the archived decision links: from, to, field, by, at and reason", usage: "adr pruned [<decision>]" },
  tool: { absent: "archived decision links are listed on the command line" },
  inputs: { decision: { kind: "text", word: 0, optional: true, describe: "Only this decision's archived links" } },
  async act({ decision }, context: VerbContext): Promise<VerbAnswer> {
    const archived = await context.library.archivedLinks(decision);
    if (archived.length === 0) return { text: "No decision link is archived." };
    return { text: archived.map(({ from, to, field, by, at, reason }) => `  ${from} -> ${to}  ${field}  by ${by} at ${at}: ${reason}`).join("\n") };
  },
});

export const RESTORE = verb({
  command: { family: "adr", name: "restore", summary: "put an archived decision link back, with its justification or --why", usage: "adr restore <decision> <target> [--why <text>]" },
  tool: { absent: "decision links are restored on the command line" },
  inputs: {
    decision: { kind: "text", word: 0, describe: "The decision the link was pruned from" },
    target: { kind: "text", word: 1, describe: "The record it linked to" },
    why: { kind: "text", optional: true, describe: "The link's justification, for one archived with none" },
  },
  writes: true,
  async act({ decision, target, why }, context: VerbContext): Promise<VerbAnswer> {
    await refusing(() => context.library.restoreLink(decision, target, why, context.writer));
    return { text: `Restored ${decision}'s link to ${target}.` };
  },
});

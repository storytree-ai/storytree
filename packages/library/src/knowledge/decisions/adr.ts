// Capability 13 · Decision log
import { refusing, verb, VerbRefusal, type VerbAnswer, type VerbContext, type VerbFamily } from "../../commands/kit/index.js";
import { PULL, PUSH } from "./adr-file.js";
import { BACKLOG, CHANGES, MOVE_NARROWS, PAIRS, PRUNE, PRUNED, RESTORE } from "./adr-links.js";
import { recordDecision } from "./door.js";
import type { NewDecision } from "./knowledge.js";
import { adr } from "./numbering.js";

function listed(text: string | undefined): string[] {
  return (text ?? "").split(",").map((one) => one.trim()).filter((one) => one !== "");
}

function justifications(why: readonly string[]): Record<string, string> {
  return Object.fromEntries(why.map((one) => {
    const at = one.indexOf("=");
    if (at <= 0) throw new VerbRefusal(`--why takes <target>=<justification>, not ${JSON.stringify(one)}; nothing was written`, { misuse: true });
    return [one.slice(0, at).trim(), one.slice(at + 1).trim()];
  }));
}

interface Stamp {
  readonly basis?: string | undefined;
  readonly "owner-said"?: string | undefined;
  readonly "brought-from"?: string | undefined;
  readonly "brought-basis"?: string | undefined;
}

function authorityOf(stamp: Stamp, scribedBy: string): NonNullable<NewDecision["authority"]> {
  const basis = stamp.basis ?? "agent-derived";
  const brought = stamp["brought-from"] !== undefined || stamp["brought-basis"] !== undefined;
  if (brought && basis !== "brought-across") throw new VerbRefusal("--brought-from and --brought-basis name a 0.2 record: they go with --basis brought-across; nothing was written", { misuse: true });
  return {
    basis,
    scribedBy,
    at: new Date().toISOString(),
    ...(stamp["owner-said"] === undefined ? {} : { ownerSaid: stamp["owner-said"] }),
    ...(stamp["brought-from"] === undefined ? {} : { broughtFrom: { record: stamp["brought-from"], basis: stamp["brought-basis"] } }),
  } as NonNullable<NewDecision["authority"]>;
}

async function refuseUnjustified(context: VerbContext, targets: readonly string[], why: Readonly<Record<string, string>>): Promise<void> {
  for (const target of targets) {
    if (Object.hasOwn(why, target) || (await context.library.get(target))?.type !== "decision") continue;
    throw new VerbRefusal(`a decision link carries its justification: give --why ${target}=<why follow it, in at most two lines>; nothing was written`, { misuse: true });
  }
}

const NEW = verb({
  command: { family: "adr", name: "new", summary: "record a decision with who decided it and what it supersedes", usage: "adr new --title <t> --text <text> --status accepted [--basis <basis> --owner-said <words> | --basis brought-across --brought-from <record> --brought-basis <basis>] [--supersedes a,b] [--links a,b] [--why <target>=<text>]… [--decided YYYY-MM-DD] [--number <n>] [--front-cover-of <node>] [--load-bearing]" },
  tool: { absent: "a decision is recorded on the command line" },
  inputs: {
    title: { kind: "text", describe: "The decision, in a line" },
    text: { kind: "text", describe: "Its text" },
    status: { kind: "text", describe: "accepted: a decision waiting on the owner is an open question instead" },
    number: { kind: "count", optional: true, describe: "Its number, when it is not the next" },
    decided: { kind: "text", optional: true, describe: "The day it was decided, YYYY-MM-DD" },
    basis: { kind: "text", optional: true, describe: "Who decided it: owner-directed, owner-ratified, agent-derived (the default), agent-flipped or brought-across" },
    "owner-said": { kind: "text", optional: true, describe: "The owner's own words, for an owner basis" },
    "brought-from": { kind: "text", optional: true, describe: "The 0.2 record a brought-across decision carries" },
    "brought-basis": { kind: "text", optional: true, describe: "The basis 0.2 gave it" },
    supersedes: { kind: "text", optional: true, describe: "The decisions it supersedes, comma-separated" },
    links: { kind: "text", optional: true, describe: "The records it links to, comma-separated" },
    why: { kind: "text", many: true, optional: true, describe: "A decision link's justification, as <target>=<text>" },
    "front-cover-of": { kind: "text", optional: true, describe: "The story or capability it is the front cover of" },
    "load-bearing": { kind: "switch", describe: "Mark it load-bearing" },
  },
  writes: true,
  async act(input, context: VerbContext): Promise<VerbAnswer> {
    const supersedes = listed(input.supersedes);
    const links = listed(input.links);
    const why = justifications(input.why ?? []);
    const authority = authorityOf(input, context.session);
    await refuseUnjustified(context, [...links, ...supersedes], why);
    const kept = Object.fromEntries(Object.entries(why).filter(([target]) => links.includes(target) || supersedes.includes(target)));
    const decision = {
      title: input.title,
      text: input.text,
      status: input.status,
      ...(input.number === undefined ? {} : { number: input.number }),
      ...(input.decided === undefined ? {} : { decided: input.decided }),
      ...(links.length === 0 ? {} : { links }),
      ...(supersedes.length === 0 ? {} : { supersedes }),
      ...(Object.keys(kept).length === 0 ? {} : { justifications: kept }),
      ...(input["front-cover-of"] === undefined ? {} : { frontCoverOf: input["front-cover-of"] }),
      ...(input["load-bearing"] === true ? { loadBearing: true } : {}),
      authority,
    } as NewDecision;
    const record = await refusing(() => recordDecision(context.library, decision, context.writer));
    const number = record.fields.number === undefined ? "" : `${adr(record.fields.number)} `;
    return { text: `Recorded ${number}${record.id}: ${record.fields.title}.`, data: { id: record.id } };
  },
});

const LIST = verb({
  command: { family: "adr", name: "list", summary: "the decisions: current, by status, load-bearing", usage: "adr list [--current] [--status <status>] [--load-bearing]" },
  tool: { absent: "decisions are listed on the command line" },
  inputs: {
    current: { kind: "switch", describe: "Only the accepted decisions nothing supersedes" },
    status: { kind: "text", optional: true, describe: "Only decisions reading this status: proposed, accepted or superseded" },
    "load-bearing": { kind: "switch", describe: "Only the load-bearing decisions nothing supersedes" },
  },
  async act(input, context: VerbContext): Promise<VerbAnswer> {
    const views = (await context.library.decisions()).filter(({ status, record }) =>
      (input.current !== true || status === "accepted")
      && (input.status === undefined || status === input.status)
      && (input["load-bearing"] !== true || (status !== "superseded" && record.fields.loadBearing === true)));
    if (views.length === 0) return { text: "No decision matches." };
    return { text: views.map(({ status, record }) => `${record.fields.number === undefined ? "(no number)" : adr(record.fields.number)}  ${record.id}  ${status}  ${record.fields.title}`).join("\n") };
  },
});

export const ADR_FAMILY: VerbFamily = {
  name: "adr",
  summary: "the decision log: new, pull, push, list, move-narrows, pairs, backlog, changes, prune, pruned, restore",
  order: 4,
  verbs: [NEW, PULL, PUSH, LIST, MOVE_NARROWS, PAIRS, BACKLOG, CHANGES, PRUNE, PRUNED, RESTORE],
};

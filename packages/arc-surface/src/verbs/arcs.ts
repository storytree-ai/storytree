// Capability 3 · Arc surface.
import { verb, VerbRefusal, type VerbFamilies } from "@storytree/library/verbs";
import { beforeCutover, listedNotice, pullSaid, type ArcView, type Holds, type NoteWait, type WaitFor } from "@storytree/library";

import { recentWindow, windowOf, type ClosedRange } from "../board/closed-range.js";
import { questionsBehind } from "../work-states/board-states.js";
import { oversizedSaid } from "./arc-size.js";
import { holdsNow } from "./claimed.js";
import { labelOf, listOf, readsAcross, readsElsewhere, releasedAsking, type ArcVerbContext } from "./context.js";
import { recent } from "./recent.js";
import { status } from "./status.js";

const NO_TOOL = "the MCP server's own plan tools do this";

function fieldsOf(given: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(given)) if (value !== undefined) fields[name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  return fields;
}

function priorityOf(value: string | undefined): { priority?: number | undefined } {
  if (value === undefined) return {};
  if (value === "none") return { priority: undefined };
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new VerbRefusal(`--priority is a whole number of 1 or more (1 first), or none to clear it; not "${value}"`);
  return { priority: Number(value) };
}

function actionRankOf(flag: string, value: string | undefined): { rank?: number } {
  if (value === undefined) return {};
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new VerbRefusal(`--${flag} is a whole number of 1 or more (1 first); not "${value}"`, { misuse: true });
  return { rank: Number(value) };
}

const rankOf = (view: Pick<ArcView, "arc">): number => view.arc.fields.priority ?? Infinity;

function pendingSaid(id: string, count: number): string {
  return `Pending changes (${count}), applied when its branch merges: storytree library read ${id} lists them`;
}

function holdsOn(holds: Holds, id: string): string[] {
  const lines: string[] = [];
  for (const hold of holds.waits[id] ?? []) {
    lines.push(`waits on ${hold.on}: ${hold.reason}${hold.forGood ? " (never releases: the blocker did not land, or is gone)" : ""}`);
  }
  for (const question of holds.heldOn[id] ?? []) lines.push(`waiting on you: question ${question}`);
  for (const question of questionsBehind(id, holds)) lines.push(`waiting on you: question ${question} (through other work)`);
  for (const wait of holds.waitsFor?.[id] ?? []) lines.push(waitSaid(wait));
  return lines;
}

function waitSaid({ releaser, note, checkBack, holds }: NoteWait): string {
  if (releaser === "owner") return `waiting on you: ${note}`;
  return holds ? `waits for an event: ${note} (check back ${checkBack})` : `check-back passed ${checkBack}: ${note}`;
}

function stateOf({ state, wakes }: Pick<ArcView, "state" | "wakes">): string {
  return state === "parked" && wakes !== undefined ? `parked until ${wakes} (UTC)` : state;
}

const show = verb({
  command: { family: "arc", name: "show", summary: "one arc whole: intent, end state, increments, what each waits for, and your questions" },
  tool: { absent: "the MCP server's own show_plan shows the plan" },
  inputs: { arc: { kind: "text", word: 0, describe: "the arc's id" } },
  async act({ arc: id }, context: ArcVerbContext) {
    const { library } = context;
    const [view, unread, cutover] = await Promise.all([library.arcView(id), library.holds(), library.prCutover()]);
    const holds = await holdsNow(context, unread);
    if (view === null) throw new VerbRefusal(`no arc "${id}" in this project`);
    const { arc, state, increments, questions } = view;
    const lines = [`${arc.fields.title}  [${arc.id}]  ${stateOf(view)}`, "", `Intent: ${arc.fields.intent}`, `End state: ${arc.fields.endState}`];
    if (arc.fields.priority !== undefined) lines.push(`Priority: ${arc.fields.priority}`);
    const oversized = oversizedSaid(increments.length);
    if (oversized !== undefined) lines.push(oversized);
    for (const line of holdsOn(holds, arc.id)) lines.push(`This arc ${line}`);
    const open = increments.filter((increment) => increment.fields.status !== "closed");
    const closed = increments.filter((increment) => increment.fields.status === "closed");
    lines.push("", `Work (${open.length} open)`);
    if (open.length === 0) lines.push("  (none)");
    for (const increment of open) {
      lines.push(`  - ${increment.id}  [${increment.fields.status}]  ${increment.fields.title}`);
      for (const line of holdsOn(holds, increment.id)) lines.push(`      ${line}`);
      const pending = increment.fields.pending?.length ?? 0;
      if (pending > 0) lines.push(`      ${pendingSaid(increment.id, pending)}`);
    }
    const waiting = questions.filter((question) => question.fields.lifecycle === "open");
    lines.push("", state === "parked" ? `Questions parked with the arc, waiting for it to be unparked (${waiting.length})` : `Questions waiting on you (${waiting.length})`);
    for (const question of waiting) lines.push(`  - ${question.id}  ${labelOf(question.fields)}`);
    const settled = questions.filter((question) => question.fields.lifecycle === "settled");
    if (settled.length > 0) {
      lines.push("", `Settled questions (${settled.length})`);
      for (const question of settled) lines.push(`  - ${question.id}  ${labelOf(question.fields)}: ${question.fields.answer ?? ""}`);
    }
    lines.push("", `Increment log (${closed.length} closed)`);
    for (const increment of closed) {
      const outcome = increment.fields.outcome;
      const pr = outcome?.pr !== undefined && beforeCutover(cutover, outcome.date) ? pullSaid(cutover, outcome.pr, outcome.date) : outcome?.pr;
      const how = [outcome?.date, outcome?.disposition, pr].filter((part) => part !== undefined).join("  ");
      lines.push(`  - ${how}  ${increment.id}  ${increment.fields.title}`);
      if (outcome?.note !== undefined) lines.push(`      ${outcome.note}`);
    }
    return { text: lines.join("\n") };
  },
});

const ARC_INPUTS = {
  title: { kind: "text", optional: true, describe: "its title" },
  intent: { kind: "text", optional: true, describe: "what it exists to deliver" },
  "end-state": { kind: "text", optional: true, describe: "what closed looks like" },
  description: { kind: "text", optional: true, describe: "more about it" },
  stories: { kind: "text", optional: true, describe: "the stories it serves, comma-separated" },
} as const;

const create = verb({
  command: { family: "arc", name: "new", summary: "a new arc, whole: its intent and end state", usage: "arc new --title <t> --intent <text|@file> --end-state <text|@file> [--stories a,b]" },
  tool: { absent: NO_TOOL },
  inputs: ARC_INPUTS,
  writes: true,
  async act({ stories: given, ...rest }, context: ArcVerbContext) {
    const stories = listOf(given, "stories");
    const arc = await context.library.createArc({ ...fieldsOf(rest), ...(stories === undefined ? {} : { stories }) } as never, context.writer);
    return { text: `Created arc ${arc.id}.`, next: [{ command: `arc show ${arc.id}`, why: "see it whole" }] };
  },
});

const edit = verb({
  command: {
    family: "arc",
    name: "edit",
    summary: "change only the named fields; --priority ranks the arc, 1 first, and none clears it",
    usage: "arc edit <arc> [--title …] [--intent …] [--end-state …] [--stories a,b] [--priority <n|none>]",
  },
  tool: { absent: NO_TOOL },
  inputs: { arc: { kind: "text", word: 0, describe: "the arc's id" }, ...ARC_INPUTS, priority: { kind: "text", optional: true, blank: true, describe: "its rank, 1 first, or none to clear it" } },
  writes: true,
  async act({ arc: id, stories: given, priority, ...rest }, context: ArcVerbContext) {
    const stories = listOf(given, "stories");
    const edited = await context.library.editArc(id, { ...fieldsOf(rest), ...(stories === undefined ? {} : { stories }), ...priorityOf(priority) } as never, context.writer);
    if (edited === null) throw new VerbRefusal(`no arc "${id}" in this project`);
    return { text: `Edited arc ${id}.`, next: [{ command: `arc show ${id}`, why: "see it whole" }] };
  },
});

const park = verb({
  command: { family: "arc", name: "park", summary: "hold an arc: it reads parked until unparked, or until the day given (UTC midnight)", usage: "arc park <arc> [--until YYYY-MM-DD]" },
  tool: { absent: NO_TOOL },
  inputs: { arc: { kind: "text", word: 0, describe: "the arc's id" }, until: { kind: "text", optional: true, describe: "the day it wakes" } },
  writes: true,
  async act({ arc: id, until }, context: ArcVerbContext) {
    const done = await context.library.parkArc(id, { ...context.writer, ...(until === undefined ? {} : { until }) });
    if (done === null) throw new VerbRefusal(`no arc "${id}" in this project`);
    return { text: `Parked arc ${id}${until === undefined ? "" : ` until ${until} (it wakes at UTC midnight)`}.` };
  },
});

const unpark = verb({
  command: { family: "arc", name: "unpark", summary: "take an arc off hold" },
  tool: { absent: NO_TOOL },
  inputs: { arc: { kind: "text", word: 0, describe: "the arc's id" } },
  writes: true,
  async act({ arc: id }, context: ArcVerbContext) {
    const done = await context.library.unparkArc(id, context.writer);
    if (done === null) throw new VerbRefusal(`no arc "${id}" in this project`);
    return { text: `Unparked arc ${id}.` };
  },
});

function releasedBy(releaser: WaitFor["releaser"]): string {
  return releaser === "owner" ? "the owner" : "an outside event";
}

function releaserOf(on: string | undefined, releaser: string | undefined): WaitFor["releaser"] | undefined {
  if ((on !== undefined) === (releaser !== undefined)) throw new VerbRefusal("give exactly one of --on and --for", { misuse: true });
  if (releaser === undefined || releaser === "owner" || releaser === "event") return releaser;
  throw new VerbRefusal(`--for is owner or event, not "${releaser}"`, { misuse: true });
}

function needed(value: string | undefined, name: string): string {
  if (value === undefined) throw new VerbRefusal(`this needs --${name}`, { misuse: true });
  return value;
}

const arcWait = verb({
  command: { family: "arc", name: "wait", summary: "make an arc wait on another arc or an increment, with a reason", usage: "arc wait <arc> --on <arc|increment> --reason <why>" },
  tool: { absent: NO_TOOL },
  inputs: { arc: { kind: "text", word: 0, describe: "the arc's id" }, on: { kind: "text", optional: true, describe: "the arc or increment it waits on" }, reason: { kind: "text", optional: true, describe: "why" } },
  writes: true,
  async act({ arc: id, on, reason }, context: ArcVerbContext) {
    const blocker = needed(on, "on");
    const done = await context.library.addWait(id, blocker, needed(reason, "reason"), context.writer);
    if (done === null) throw new VerbRefusal(`no arc "${id}" in this project`);
    return { text: `${id} now waits on ${blocker}.` };
  },
});

const arcUnwait = verb({
  command: { family: "arc", name: "unwait", summary: "clear a wait, saying why", usage: "arc unwait <arc> --on <arc|increment> --reason <why>" },
  tool: { absent: NO_TOOL },
  inputs: {
    arc: { kind: "text", word: 0, describe: "the arc's id" },
    on: { kind: "text", optional: true, describe: "the arc or increment it waits on" },
    reason: { kind: "text", optional: true, describe: "why it is cleared, kept in the arc's history" },
  },
  writes: true,
  async act({ arc: id, on, reason }, context: ArcVerbContext) {
    const blocker = needed(on, "on");
    const done = await context.library.removeWait(id, blocker, { ...context.writer, reason: needed(reason, "reason") });
    if (done === null) throw new VerbRefusal(`no arc "${id}" in this project`);
    return { text: `${id} no longer waits on ${blocker}.` };
  },
});

const incrementWait = verb({
  command: {
    family: "arc increment",
    name: "wait",
    summary: "make an increment wait on another, with a reason; or for you, or an outside event until a check-back day, with a note",
    usage: "arc increment wait <increment> --on <increment> --reason <why>, or --for owner --note <text|@file> --why <text|@file> [--rank <n>], or --for event --note <text|@file> --check-back YYYY-MM-DD",
  },
  tool: { absent: NO_TOOL },
  inputs: {
    increment: { kind: "text", word: 0, describe: "the increment's id" },
    on: { kind: "text", optional: true, describe: "the increment it waits on" },
    reason: { kind: "text", optional: true, describe: "why" },
    for: { kind: "text", optional: true, describe: "owner or event" },
    note: { kind: "text", optional: true, describe: "what it waits for; written again for you, left out it keeps the one it has" },
    why: { kind: "text", optional: true, describe: "with --for owner: what your action protects or unblocks, in a line; left out it keeps the one it has" },
    rank: { kind: "text", optional: true, describe: "with --for owner: where it ranks among your actions, a whole number, 1 first" },
    "check-back": { kind: "text", optional: true, describe: "the day to check back, for an event" },
  },
  writes: true,
  async act({ increment: id, on, reason, for: waitingFor, note, why, rank, "check-back": checkBack }, context: ArcVerbContext) {
    const releaser = releaserOf(on, waitingFor);
    if (releaser !== undefined) {
      if (releaser === "event") needed(note, "note");
      const done = await context.library.addWaitFor(id, { releaser, ...fieldsOf({ note, why, checkBack }), ...actionRankOf("rank", rank) }, context.writer);
      if (done === null) throw new VerbRefusal(`no increment "${id}" in this project`);
      const said = done.fields.waitsFor?.find((one) => one.releaser === releaser)?.note ?? note;
      const released = releaser === "owner" ? await releasedAsking(context, id) : "";
      return { text: `${id} now waits for ${releasedBy(releaser)}: ${said}${checkBack === undefined ? "" : ` (check back ${checkBack})`}.${released}` };
    }
    const done = await context.library.addWait(id, on!, needed(reason, "reason"), context.writer);
    if (done === null) throw new VerbRefusal(`no increment "${id}" in this project`);
    return { text: `${id} now waits on ${on}.` };
  },
});

const incrementUnwait = verb({
  command: {
    family: "arc increment",
    name: "unwait",
    summary: "clear a wait, saying why; clearing one for you to finish the increment yourself, --claim claims it first, so the pool never starts it in between",
    usage: "arc increment unwait <increment> --on <increment> --reason <why>, or --for owner|event --reason <why>, or --for event --merged <pr>, or --for owner --claim <reason>",
  },
  tool: { absent: NO_TOOL },
  inputs: {
    increment: { kind: "text", word: 0, describe: "the increment's id" },
    on: { kind: "text", optional: true, describe: "the increment it waits on" },
    for: { kind: "text", optional: true, describe: "owner or event" },
    claim: { kind: "text", optional: true, describe: "with --for owner, when this session finishes it: the claim's reason, taken before the wait clears" },
    merged: { kind: "text", optional: true, describe: "with --for event: the pull request it was handed over with, which has merged; its wait for you is then listed for reading again" },
    reason: { kind: "text", optional: true, describe: "why it is cleared, kept in the increment's history (--claim's reason and --merged's pull request give one)" },
  },
  writes: true,
  async act({ increment: id, on, for: waitingFor, claim, merged, reason: given }, context: ArcVerbContext) {
    const releaser = releaserOf(on, waitingFor);
    const reason = given ?? (merged === undefined ? undefined : `pull request #${merged} merged`);
    if (reason === undefined && claim === undefined) needed(reason, "reason");
    if (merged !== undefined && releaser !== "event") throw new VerbRefusal("--merged goes with --for event", { misuse: true });
    if (merged !== undefined && !/^[1-9]\d*$/.test(merged)) throw new VerbRefusal(`--merged is a pull request number; not "${merged}"`, { misuse: true });
    if (claim !== undefined) {
      if (releaser !== "owner") throw new VerbRefusal("--claim goes with --for owner", { misuse: true });
      if (context.session.startsWith("person:")) throw new VerbRefusal("Run it from the agent's shell: a claim belongs to the agent session that will finish the work.");
      const { claimClearingOwnerWait } = await import("@storytree/session-management/tools");
      const { workspaceRefusalText } = await import("@storytree/session-management/workspace-verbs");
      const answer = await claimClearingOwnerWait(context, id, claim);
      if (!answer.ok) throw new VerbRefusal(`${workspaceRefusalText(id, answer)} Its wait for the owner stands.`);
      return { text: `${id} no longer waits for the owner, and ${context.session} holds it: ${claim}.` };
    }
    if (releaser !== undefined) {
      const done = await context.library.removeWaitFor(id, releaser, { ...context.writer, reason: reason! }, merged === undefined ? undefined : { merged: Number(merged) });
      if (done === null) throw new VerbRefusal(`no increment "${id}" in this project`);
      const { CLOUD_MACHINE } = await import("@storytree/session-management/machines");
      const cloud = (done.fields as { machine?: string }).machine === CLOUD_MACHINE;
      const ready = releaser !== "owner" ? "" : cloud
        ? ` Nobody holds it, and only a cloud container takes it (its machine is ${CLOUD_MACHINE}), so the pool never starts it: start a cloud session on it.`
        : " Nobody holds it, so the pool may start it now: to finish it yourself, clear it with --claim <reason> instead.";
      return { text: `${id} no longer waits for ${releasedBy(releaser)}.${ready}` };
    }
    const done = await context.library.removeWait(id, on!, { ...context.writer, reason: reason! });
    if (done === null) throw new VerbRefusal(`no increment "${id}" in this project`);
    return { text: `${id} no longer waits on ${on}.` };
  },
});

const PLAN_INPUTS = {
  arc: { kind: "text", optional: true, describe: "the arc it is on" },
  title: { kind: "text", optional: true, describe: "its title" },
  objective: { kind: "text", optional: true, describe: "what it delivers" },
  body: { kind: "text", optional: true, describe: "its breakdown" },
  capabilities: { kind: "text", optional: true, blank: true, describe: "the capabilities its contracts' paths cross, comma-separated, or none to empty the list" },
  links: { kind: "text", optional: true, describe: "what it cites, comma-separated" },
  remedies: { kind: "text", optional: true, blank: true, describe: "the friction it remedies, comma-separated, or none to clear" },
  "held-on": { kind: "text", optional: true, blank: true, describe: "the owner's questions it is held on, comma-separated, or none to clear" },
  machine: { kind: "text", optional: true, describe: "the one machine that can take it, cloud for work only a cloud container can prove (no dispatcher takes it), or none to clear" },
  "escape-of": { kind: "text", optional: true, describe: "the pull request (#123) or increment that caused the escape it fixes, or none to clear" },
  "escape-commit": { kind: "text", optional: true, describe: "the merge commit of the pull request --escape-of names (numbers restarted at #2 on 2026-10-26)" },
  "escape-story": { kind: "text", optional: true, describe: "the story that escape hit, with --escape-of" },
  touches: { kind: "text", optional: true, describe: "retired: --capabilities and --links" },
} as const;

type PlanGiven = { readonly [K in keyof typeof PLAN_INPUTS]?: string | undefined };

function incrementOf({ capabilities, links, remedies, "held-on": heldOn, machine: _machine, "escape-of": escapeOf, "escape-commit": escapeCommit, "escape-story": escapeStory, touches, ...rest }: PlanGiven): Record<string, unknown> {
  if (touches !== undefined) {
    throw new VerbRefusal("--touches is retired (ADR-0949 D2): name the capabilities it changes with --capabilities, and cite its stories or anything else with --links", { misuse: true });
  }
  const fields: Record<string, unknown> = fieldsOf(rest);
  for (const [flag, field, value] of [["capabilities", "capabilities", capabilities], ["links", "links", links], ["remedies", "remedies", remedies], ["held-on", "heldOn", heldOn]] as const) {
    const list = listOf(value, flag);
    if (list !== undefined) fields[field] = list;
  }
  if ((fields.capabilities as string[] | undefined)?.join() === "none") fields.capabilities = [];
  if ((fields.remedies as string[] | undefined)?.join() === "none") fields.remedies = [];
  const held = fields.heldOn as string[] | undefined;
  if (held?.length === 0 || (held?.length === 1 && held[0] === "none")) fields.heldOn = undefined;
  if (escapeOf === "none" && escapeStory === undefined && escapeCommit === undefined) fields.escape = undefined;
  else if (escapeOf !== undefined && escapeOf !== "none" && escapeStory !== undefined) fields.escape = { causedBy: escapeOf, ...(escapeCommit === undefined ? {} : { commit: escapeCommit }), story: escapeStory };
  else if (escapeOf !== undefined || escapeStory !== undefined || escapeCommit !== undefined) {
    throw new VerbRefusal("--escape-of and --escape-story go together, with --escape-commit for a pull request: the pull request (and its merge commit) or increment that caused the escape, and the story it hit (or --escape-of none alone to clear it)", { misuse: true });
  }
  return fields;
}

async function machineGiven(name: string | undefined, context: ArcVerbContext): Promise<{ machine?: string | undefined }> {
  if (name === undefined) return {};
  const { incrementMachine, MachineNameError } = await import("@storytree/session-management/machines");
  if (context.server === undefined) throw new VerbRefusal("--machine: the machines' names cannot be read here");
  try {
    return { machine: await incrementMachine(context.server, name) };
  } catch (error) {
    if (error instanceof MachineNameError) throw new VerbRefusal(`--machine: ${error.message}`);
    throw error;
  }
}

const INCREMENT_USAGE = "--arc <arc> --title <t> --objective <o> --body <text|@file> [--capabilities a,b] [--links a,b] [--remedies a,b] [--held-on q] [--machine <name>] [--escape-of <pr|increment> [--escape-commit <sha>] --escape-story <story>]";

const CLOSE_INPUTS = {
  disposition: { kind: "text", optional: true, describe: "landed, failed or withdrawn" },
  pr: { kind: "text", optional: true, describe: "its pull request" },
  note: { kind: "text", optional: true, describe: "why" },
  date: { kind: "text", optional: true, describe: "the day it closed, YYYY-MM-DD" },
} as const;

function closeOf(given: { disposition?: string | undefined; pr?: string | undefined; note?: string | undefined; date?: string | undefined }): { disposition: never; pr?: string; note?: string; date?: string } {
  return fieldsOf(given) as never;
}

const incrementNew = verb({
  command: { family: "arc increment", name: "new", summary: "park an increment on an arc, as a proposal", usage: `arc increment new ${INCREMENT_USAGE} [--waits-on a,b --wait-reason <why>] [--wait-for owner --wait-note <text|@file> --wait-why <text|@file> [--wait-rank <n>]]` },
  tool: { absent: NO_TOOL },
  inputs: {
    ...PLAN_INPUTS,
    "waits-on": { kind: "text", optional: true, describe: "the increments, or capabilities whose claims, it is born waiting on, comma-separated" },
    "wait-reason": { kind: "text", optional: true, describe: "why it waits on them" },
    "wait-for": { kind: "text", optional: true, describe: "owner: it is born waiting for you" },
    "wait-note": { kind: "text", optional: true, describe: "with --wait-for owner: what you must do before it can start" },
    "wait-why": { kind: "text", optional: true, describe: "with --wait-for owner: what your action protects or unblocks, in a line" },
    "wait-rank": { kind: "text", optional: true, describe: "with --wait-for owner: where it ranks among your actions, a whole number, 1 first" },
  },
  writes: true,
  async act({ "waits-on": waitsOn, "wait-reason": reason, "wait-for": waitFor, "wait-note": waitNote, "wait-why": waitWhy, "wait-rank": waitRank, ...given }, context: ArcVerbContext) {
    const on = listOf(waitsOn, "waits-on");
    if ((on !== undefined || reason !== undefined) && (on === undefined || on.length === 0 || reason === undefined)) {
      throw new VerbRefusal("--waits-on and --wait-reason go together: the increments or capabilities it waits on, and why", { misuse: true });
    }
    const waits = on === undefined ? {} : { waits: on.map((id) => ({ on: id, reason: reason! })) };
    if ((waitFor !== undefined || waitNote !== undefined) && (waitFor !== "owner" || waitNote === undefined)) {
      throw new VerbRefusal("--wait-for owner and --wait-note go together: a new increment is born waiting only for you, with what you must do (an event wait is set after, with `arc increment wait`)", { misuse: true });
    }
    if (waitNote === undefined && (waitWhy !== undefined || waitRank !== undefined)) throw new VerbRefusal("--wait-why and --wait-rank go with --wait-for owner --wait-note", { misuse: true });
    const owner = { releaser: "owner" as const, note: waitNote!, ...fieldsOf({ why: waitWhy }), ...actionRankOf("wait-rank", waitRank) };
    const waitsFor = waitNote === undefined ? {} : { waitsFor: [owner] };
    const increment = await context.library.addIncrement({ ...incrementOf(given), ...waits, ...waitsFor, ...(await machineGiven(given.machine, context)) } as never, context.writer).catch((error: unknown) => {
      throw error instanceof RangeError ? new VerbRefusal(error.message) : error;
    });
    return { text: `Parked increment ${increment.id} on ${increment.fields.arc}.`, next: [{ command: `arc show ${increment.fields.arc}`, why: "see the arc whole" }] };
  },
});

const incrementAdd = verb({
  command: {
    family: "arc increment",
    name: "add",
    summary: "record a landing that was never parked: an increment born closed",
    usage: `arc increment add ${INCREMENT_USAGE} --disposition <landed|failed|withdrawn> [--pr <ref>] [--note <why>]`,
  },
  tool: { absent: NO_TOOL },
  inputs: { ...PLAN_INPUTS, ...CLOSE_INPUTS },
  writes: true,
  async act({ disposition, pr, note, date, ...given }, context: ArcVerbContext) {
    const increment = await context.library.addIncrement({ ...incrementOf(given), ...(await machineGiven(given.machine, context)), outcome: closeOf({ disposition, pr, note, date }) } as never, context.writer);
    return { text: `Recorded increment ${increment.id} on ${increment.fields.arc}, closed.`, next: [{ command: `arc show ${increment.fields.arc}`, why: "see its log" }] };
  },
});

const incrementClose = verb({
  command: {
    family: "arc increment",
    name: "close",
    summary: "close an increment with its outcome and end any claim on it",
    usage: "arc increment close <increment> --disposition <landed|failed|withdrawn> [--pr <ref>] [--note <why>]",
  },
  tool: { absent: "the MCP server's own close_increment closes an increment" },
  inputs: { increment: { kind: "text", word: 0, describe: "the increment's id" }, ...CLOSE_INPUTS },
  writes: true,
  async act({ increment: id, ...given }, context: ArcVerbContext) {
    const outcome = closeOf(given);
    const { closeRefusalText } = await import("@storytree/session-management/tools");
    const refused = await closeRefusalText(context, id);
    if (refused !== undefined) throw new VerbRefusal(refused);
    const done = await context.library.closeIncrement(id, outcome, context.writer);
    if (done === null) throw new VerbRefusal(`no increment "${id}" in this project`);
    const { closed } = await import("@storytree/session-management");
    await closed(context, id, outcome.disposition);
    await context.journey?.().then((journey) => journey.incrementClosed(done.fields.outcome?.disposition)).catch(() => {});
    return { text: `Closed increment ${id}: ${done.fields.outcome?.disposition ?? ""}. Any claim on it has ended.`, next: [{ command: `arc show ${done.fields.arc}`, why: "see the arc" }] };
  },
});

const incrementUnstart = verb({
  command: { family: "arc increment", name: "unstart", summary: "return an active increment nobody holds to proposal, keeping its parked date" },
  tool: { absent: NO_TOOL },
  inputs: { increment: { kind: "text", word: 0, describe: "the increment's id" } },
  writes: true,
  async act({ increment: id }, context: ArcVerbContext) {
    const { library } = context;
    const increment = await library.get(id);
    if (increment?.type !== "increment") throw new VerbRefusal(`no increment "${id}" in this project`);
    const status = (increment.fields as { status: string }).status;
    if (status !== "active") throw new VerbRefusal(`${id} is ${status}, not active: only active work returns to proposal.`);
    const { readClaims } = await import("@storytree/session-management");
    const holder = (await readClaims(context.log, context.library.name)).find((claim) => claim.increment === id);
    if (holder !== undefined) throw new VerbRefusal(`${id} is held by ${holder.label} session ${holder.session} (${holder.reason}): it is work in progress. Its holder releases it, which returns it to proposal.`);
    await library.returnIncrement(id, context.writer);
    return { text: `${id} is a proposal again: nobody holds it.`, next: [{ command: `arc show ${(increment.fields as { arc: string }).arc}`, why: "see the arc" }] };
  },
});

const incrementEdit = verb({
  command: {
    family: "arc increment",
    name: "edit",
    summary: "change only the named fields; --capabilities and --links replace the lists, --remedies adds friction to those it already remedies, or none to clear, --machine names the one machine that can take it, --escape-of, --escape-commit and --escape-story the escape it fixes",
    usage: "arc increment edit <increment> [--title …] [--objective …] [--body …] [--capabilities a,b, or none to empty] [--links a,b] [--remedies f,g, or none to clear] [--held-on q, or none to clear] [--machine <name>, or none to clear] [--escape-of <pr|increment> [--escape-commit <sha>] --escape-story <story>, or --escape-of none to clear]",
  },
  tool: { absent: "the MCP server's own edit_plan edits an increment" },
  inputs: { increment: { kind: "text", word: 0, describe: "the increment's id" }, ...PLAN_INPUTS },
  writes: true,
  async act({ increment: id, ...given }, context: ArcVerbContext) {
    const { library } = context;
    const fields: Record<string, unknown> = { ...incrementOf(given), ...(await machineGiven(given.machine, context)) };
    if (((fields.remedies as string[] | undefined) ?? []).length > 0) {
      const had = ((await library.get(id))?.fields as { remedies?: string[] } | undefined)?.remedies ?? [];
      fields.remedies = [...new Set([...had, ...(fields.remedies as string[])])];
    }
    const had = fields.capabilities === undefined ? [] : ((await library.get(id))?.fields as { capabilities?: string[] } | undefined)?.capabilities ?? [];
    const added = ((fields.capabilities as string[] | undefined) ?? []).filter((capability) => !had.includes(capability));
    await refuseShared(id, added, context);
    const edited = await library.editIncrement(id, fields as never, context.writer);
    if (edited === null) throw new VerbRefusal(`no increment "${id}" in this project`);
    const shared = await library.openListing(added, id);
    return { text: [`Edited increment ${id}.`, ...shared.map((other) => `${listedNotice(other)}.`)].join("\n") };
  },
});

async function refuseShared(target: string, capabilities: readonly string[], context: ArcVerbContext): Promise<void> {
  const { readClaims } = await import("@storytree/session-management");
  const claims = await readClaims(context.log, context.library.name);
  const others = claims.filter((claim) => claim.session !== context.session && claim.holder === "live" && claim.increment !== undefined && claim.increment !== target);
  for (const claim of others) {
    const listed = ((await context.library.get(claim.increment!))?.fields as { capabilities?: string[] } | undefined)?.capabilities ?? [];
    const heldElsewhere = (id: string) => claims.some((one) => one.capability === id && one.holder === "live" && one.session !== claim.session);
    const capability = capabilities.find((id) => listed.includes(id) && !heldElsewhere(id));
    if (capability !== undefined)
      throw new VerbRefusal(`${capability} is already on the capabilities list of ${claim.increment}, which ${claim.label} session ${claim.session} holds (${claim.reason}): two sessions never plan changes to the same capability (ADR-0949 D2). Leave it off this list, or take other work.`);
  }
}

const incrementCorrectClosure = verb({
  command: {
    family: "arc increment",
    name: "correct-closure",
    summary: "replace a closed outcome with a reason in history; keep its date unless supplied; omitted PR and note are removed",
    usage: "arc increment correct-closure <increment> --disposition <landed|failed|withdrawn> --reason <why|@file> [--pr <ref>] [--note <text|@file>] [--date YYYY-MM-DD]",
  },
  tool: { absent: NO_TOOL },
  inputs: { increment: { kind: "text", word: 0, describe: "the increment's id" }, ...CLOSE_INPUTS, reason: { kind: "text", describe: "why it is corrected" } },
  writes: true,
  async act({ increment: id, reason, ...given }, context: ArcVerbContext) {
    const done = await context.library.correctIncrementClosure(id, closeOf(given), reason, context.writer);
    if (done === null) throw new VerbRefusal(`no increment "${id}" in this project`);
    return {
      text: `Corrected closure of increment ${id}: ${done.fields.outcome?.disposition ?? ""}. Its history keeps the correction and reason.`,
      next: [{ command: `library history ${id} --fields`, why: "see the original closure and its correction" }],
    };
  },
});

const incrementMove = verb({
  command: { family: "arc increment", name: "move", summary: "re-home an increment on another live arc, keeping its identity and lifecycle; splitting an arc, move its open increments before its closed ones, or a destination closed meanwhile refuses them until `arc park`, move, `arc unpark`" },
  tool: { absent: "the MCP server's own move_increment moves an increment" },
  inputs: {
    increment: { kind: "text", word: 0, describe: "the increment's id" },
    to: { kind: "text", describe: "the arc" },
    reason: { kind: "text", describe: "why" },
  },
  writes: true,
  async act({ increment: id, to, reason }, context: ArcVerbContext) {
    const moved = await context.library.moveIncrement(id, to, reason, context.writer);
    if (moved === null) throw new VerbRefusal(`no increment "${id}" in this project`);
    return { text: `Moved increment ${id} to ${to}.`, next: [{ command: `arc show ${to}`, why: "see the arc whole" }] };
  },
});

const incrementSettlePending = verb({
  command: { family: "arc increment", name: "settle-pending", summary: "apply the leftover pending plan changes of closed increments that landed, and drop those of ones that did not (ADR-0966)" },
  tool: { absent: NO_TOOL },
  inputs: {},
  writes: true,
  async act(_input, context: ArcVerbContext) {
    const settled = await context.library.settleClosedPending(context.writer);
    if (settled.length === 0) return { text: "No closed increment has pending plan changes left." };
    const lines = settled.map(({ increment, applied, residue, dropped }) =>
      dropped > 0
        ? `  ${increment}: dropped ${dropped}, since it did not land`
        : `  ${increment}: applied ${applied.length}${applied.length === 0 ? "" : ` (${applied.join(", ")})`}${residue === undefined ? "" : `; ${residue.changes.length} not applied, parked as ${residue.increment}`}`);
    return { text: [`Settled ${settled.length} closed ${settled.length === 1 ? "increment's" : "increments'"} pending plan changes:`, ...lines].join("\n") };
  },
});

const incrementDropPending = verb({
  command: {
    family: "arc increment",
    name: "drop-pending",
    summary: "drop one pending plan change, one something else overtook, from an open increment, with the reason (ADR-0966)",
    usage: "arc increment drop-pending <increment> <record> --reason <why>",
  },
  tool: { absent: "an overtaken pending change is rare housekeeping, done from a terminal" },
  inputs: {
    increment: { kind: "text", word: 0, describe: "the increment's id" },
    record: { kind: "text", word: 1, describe: "the story, capability or contract its pending change is to" },
    reason: { kind: "text", describe: "why it is dropped" },
  },
  writes: true,
  async act({ increment: id, record, reason }, context: ArcVerbContext) {
    const dropped = await context.library.dropPending(id, record, reason, context.writer).catch((error: unknown) => {
      throw error instanceof RangeError ? new VerbRefusal(error.message) : error;
    });
    if (dropped === null) throw new VerbRefusal(`no increment "${id}" in this project`);
    const left = dropped.fields.pending?.length ?? 0;
    return { text: `Dropped the pending change to ${record} from increment ${id}; ${left} left.`, next: [{ command: `library read ${id}`, why: "see the pending changes it still holds" }] };
  },
});

const GH_TIMEOUT_MS = 10_000;

async function mergedPull(folder: string, pr: string): Promise<number> {
  const number = pr.replace(/^#/, "");
  if (!/^[1-9]\d*$/.test(number)) throw new VerbRefusal(`--pr is a pull request's number, such as #151; not "${pr}"`, { misuse: true });
  const { execFile } = await import("node:child_process");
  const out = await new Promise<string>((resolve, reject) => {
    execFile("gh", ["pr", "view", number, "--json", "number,state,mergedAt,isCrossRepository"], { cwd: folder, timeout: GH_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      if (error === null) resolve(stdout);
      else reject(new VerbRefusal(`could not ask GitHub whether #${number} merged, so nothing was applied: ${(stderr.trim().split(/\r?\n/, 1)[0] || error.message)}`));
    });
  });
  let pull: { state?: unknown; mergedAt?: unknown; isCrossRepository?: unknown };
  try {
    pull = JSON.parse(out) as typeof pull;
  } catch {
    throw new VerbRefusal(`GitHub's answer about #${number} could not be read, so nothing was applied`);
  }
  if (pull.isCrossRepository !== false) throw new VerbRefusal(`#${number} is from a fork, or GitHub did not say whose it is: only this repository's own pull requests mark a landing, so nothing was applied`);
  if (pull.state !== "MERGED" || typeof pull.mergedAt !== "string") throw new VerbRefusal(`#${number} has not merged (GitHub says ${String(pull.state).toLowerCase()}), so nothing was applied: its pending changes apply when it merges`);
  return Number(number);
}

const incrementApplyPending = verb({
  command: {
    family: "arc increment",
    name: "apply-pending",
    summary: "apply an open increment's leftover pending plan changes under a merged pull request's mark, saying what was applied and what was stale (ADR-0966)",
    usage: "arc increment apply-pending <increment> --pr <n>",
  },
  tool: {
    name: "apply_pending",
    description: "Apply an open increment's leftover pending plan changes under the mark of a pull request that has merged: the ones its merge made true but nothing applied (a hook's apply cut short, or the watcher letting its claims go first). Refused, applying nothing, for a pull request that has not merged or is a fork's. It says which changes it applied, and which were stale or refused, parking those as one increment to redo by hand. A closed increment's leftovers are settle-pending's, from a terminal.",
  },
  inputs: {
    increment: { kind: "text", word: 0, describe: "the open increment's id" },
    pr: { kind: "text", describe: "the merged pull request whose mark they carry, such as #151" },
  },
  writes: true,
  async act({ increment: id, pr }, context: ArcVerbContext) {
    const increment = await context.library.get(id);
    if (increment === null || increment.type !== "increment") throw new VerbRefusal(`no increment "${id}" in this project`);
    const fields = increment.fields as { status?: string; pending?: readonly unknown[] };
    if (fields.status === "closed") throw new VerbRefusal(`increment ${id} is closed: \`storytree arc increment settle-pending\` settles a closed increment's leftover pending changes`);
    if ((fields.pending ?? []).length === 0) return { text: `Increment ${id} holds no pending plan changes; nothing to apply.` };
    const number = await mergedPull(context.folder, pr);
    const done = await context.library.applyPending(id, `#${number}`, context.writer);
    if (done === null) throw new VerbRefusal(`no increment "${id}" in this project`);
    const left = done.residue?.changes ?? [];
    const lines = left.map((change) => change.why === "stale"
      ? `  ${change.record}: stale, its ${change.type} moved since the change was made (history entry ${change.moved.seq}, ${change.moved.action}${change.moved.at === "" ? "" : ` ${change.moved.at}`})`
      : `  ${change.record}: refused by its editor: ${change.refusal}`);
    const head = `Applied ${done.applied.length} of increment ${id}'s pending plan changes at the merge of PR #${number}${done.applied.length === 0 ? "" : `: ${done.applied.join(", ")}`}.`;
    return {
      text: left.length === 0 ? head : [head, `Not applied (${left.length}), parked as ${done.residue!.increment} to redo by hand:`, ...lines].join("\n"),
      next: done.residue === undefined ? [] : [{ command: `library read ${done.residue.increment}`, tool: "open", why: "redo or let go of each change it could not apply" }],
    };
  },
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function closedRangeOf(closed: string | undefined, from: string | undefined, to: string | undefined): ClosedRange | undefined {
  if (closed !== undefined && (from !== undefined || to !== undefined)) throw new VerbRefusal("give --closed or --from and --to, not both");
  if (closed !== undefined) {
    if (closed !== "today" && closed !== "yesterday" && closed !== "week") throw new VerbRefusal(`--closed is today, yesterday or week; not "${closed}"`);
    return { preset: closed };
  }
  if (from === undefined && to === undefined) return undefined;
  if (from === undefined || to === undefined) throw new VerbRefusal("--from and --to are given together: the first and last closing day, both included");
  for (const [flag, day] of [["--from", from], ["--to", to]] as const) {
    if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00`))) throw new VerbRefusal(`${flag} is a day as YYYY-MM-DD; not "${day}"`);
  }
  if (from > to) throw new VerbRefusal(`--from ${from} is after --to ${to}`);
  return { from, to };
}

const list = verb({
  command: {
    family: "arc",
    name: "list",
    summary: "every live arc and those closed yesterday or today, by priority (1 first, unranked last); --closed or --from and --to list older closed arcs",
    usage: "arc list [--closed today|yesterday|week | --from <YYYY-MM-DD> --to <YYYY-MM-DD>]",
  },
  tool: { absent: "the MCP server's own show_plan shows the plan" },
  inputs: {
    closed: { kind: "text", optional: true, describe: "only the arcs closed today, yesterday or this week (the last seven days)" },
    from: { kind: "text", optional: true, describe: "only the arcs closed from this day (YYYY-MM-DD), with --to" },
    to: { kind: "text", optional: true, describe: "only the arcs closed up to this day (YYYY-MM-DD), included, with --from" },
  },
  async act({ closed, from, to }, { library }: ArcVerbContext) {
    const range = closedRangeOf(closed, from, to);
    const now = Date.now();
    const read = range === undefined ? await library.boardArcs(recentWindow(now)) : await library.closedArcs(windowOf(range, now));
    const views = [...read].sort((one, other) => rankOf(one) - rankOf(other) || 0);
    const lines = views.map((view) => {
      const priority = view.arc.fields.priority === undefined ? "" : `  priority ${view.arc.fields.priority}`;
      const state = view.closed === undefined ? stateOf(view) : `closed ${view.closed}`;
      return `  ${view.arc.id}  [${state}]${priority}  ${view.arc.fields.title}`;
    });
    const empty = range === undefined ? "No live or recently closed arcs in this project." : "No arcs closed in that window.";
    return {
      text: lines.length === 0 ? empty : [`${lines.length} arcs:`, ...lines].join("\n"),
      next: [
        { command: "arc show <arc>", why: "see one whole" },
        ...(range === undefined ? [{ command: "arc list --from <YYYY-MM-DD> --to <YYYY-MM-DD>", why: "older closed arcs" }] : []),
      ],
    };
  },
});

const actionRank = (wait: NoteWait): number => wait.rank ?? Infinity;

const REVIEW_DAYS = 7;

const waits = verb({
  command: {
    family: "arc",
    name: "waits",
    summary: "every open increment's waits for you or an outside event, across arcs: yours first by rank, each with its why, then events by check-back day; --audit lists your actions that need attention",
    usage: "arc waits [--audit]",
  },
  tool: { absent: "the MCP server's own show_plan names what waits" },
  inputs: { audit: { kind: "switch", describe: "list instead the actions of yours that need attention, oldest first, each with why" } },
  async act({ audit }, context: ArcVerbContext) {
    const { library } = context;
    const [views, unread] = await Promise.all([library.arcViews(), library.holds()]);
    const holds = await holdsNow(context, unread);
    if (audit) return auditOf(views, holds, new Date());
    const found = views.flatMap(({ arc, increments }) =>
      increments.flatMap((increment) => (holds.waitsFor?.[increment.id] ?? [])
        .filter((wait) => wait.releaser !== "owner" || !(holds.waits[increment.id] ?? []).length)
        .map((wait) => ({ wait, increment, arc }))));
    const parkedArcs = new Set(views.flatMap((view) => (view.state === "parked" ? [view.arc.id] : [])));
    const shelved = found.filter(({ wait, arc }) => wait.releaser === "owner" && parkedArcs.has(arc.id));
    const holding = [...new Set(shelved.map(({ arc }) => arc.id))];
    const aside = shelved.length === 0
      ? []
      : [`${shelved.length} more for you ${shelved.length === 1 ? "waits" : "wait"} on a parked arc until it is unparked: ${holding.join(", ")} (storytree arc show <arc> names them).`];
    const listed = found.filter((one) => !shelved.includes(one));
    if (listed.length === 0) return { text: ["No waits for you or an outside event.", ...aside].join("\n") };
    listed.sort((one, other) => (one.wait.releaser === other.wait.releaser
      ? actionRank(one.wait) - actionRank(other.wait) || (one.wait.checkBack ?? "").localeCompare(other.wait.checkBack ?? "")
      : one.wait.releaser === "owner" ? -1 : 1));
    const lines = listed.map(({ wait, increment, arc }) => {
      const day = wait.releaser === "event" ? `; check back ${wait.checkBack}${wait.holds ? "" : ", overdue"}` : "";
      const rank = wait.rank === undefined ? "" : `#${wait.rank}  `;
      const why = wait.why === undefined ? "" : ` (why: ${wait.why})`;
      return `  - ${wait.releaser === "owner" ? "you  " : "event"}  ${rank}${wait.note}${why} — ${increment.id}  ${increment.fields.title}, on ${arc.id}  ${arc.fields.title}${day}`;
    });
    return {
      text: [`${listed.length} ${listed.length === 1 ? "wait" : "waits"} for you or an outside event:`, ...lines, ...aside].join("\n"),
      next: [{ command: "arc show <arc>", why: "see a wait's arc whole" }, { command: "arc waits --audit", why: "your actions that need attention" }],
    };
  },
});

function auditOf(views: readonly ArcView[], holds: Holds, at: Date): { text: string; next?: { command: string; why: string }[] } {
  const shut = views.flatMap(({ increments }) => increments.filter((one) => one.fields.status === "closed"));
  const closedAt = (one: (typeof shut)[number]): string => {
    const date = one.fields.outcome?.date ?? "";
    const written = String(one.updatedAt ?? "");
    return date.length === 10 && written.startsWith(date) ? written : date;
  };
  const closedOn = new Map(shut.map((one) => [one.id, closedAt(one)]));
  const due = new Date(at.getTime() - REVIEW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const found = views.flatMap((view) => view.increments.flatMap((increment) => (holds.waitsFor?.[increment.id] ?? [])
    .filter((wait) => wait.releaser === "owner")
    .map((wait) => {
      const held = (holds.waits[increment.id] ?? []).length > 0 || (holds.heldOn[increment.id] ?? []).length > 0;
      const since = (id: string): boolean => closedOn.has(id) && (wait.reviewed === undefined || (closedOn.get(id) ?? "") >= wait.reviewed);
      const named = [...new Set(wait.note.match(/increment_[0-9a-f]{12}/g) ?? [])].filter(since);
      const awaited = [...new Set((increment.fields.waits ?? []).map((one) => one.on))].filter(since);
      const naming = shut.filter((one) => one.fields.outcome?.disposition === "landed" && since(one.id)
        && `${one.fields.body ?? ""}\n${one.fields.outcome.note ?? ""}`.includes(increment.id)).map((one) => one.id);
      const which = (ids: readonly string[]): string => `${ids.join(", ")}, which ${ids.length === 1 ? "has" : "have"} closed since it was last read`;
      const reasons = [
        ...(/\bnot yet\b/i.test(wait.note) && !held ? ["its note says \"not yet\", but nothing holds it"] : []),
        ...(named.length === 0 ? [] : [`its note names ${which(named)}`]),
        ...(awaited.length === 0 ? [] : [`it waits on ${which(awaited)}`]),
        ...(naming.length === 0 ? [] : [`${naming.join(", ")}, which ${naming.length === 1 ? "names" : "name"} it, ${naming.length === 1 ? "has" : "have"} landed since it was last read`]),
        ...(wait.why === undefined ? ["it has no why"] : []),
        ...(wait.rank === undefined ? ["it has no rank"] : []),
        ...(view.state === "parked" || view.state === "closed" ? [`its arc is ${view.state}`] : []),
        ...(wait.merged === undefined ? [] : [`PR #${wait.merged}, which it was handed over with, has merged since it was last read`]),
        ...(wait.reviewed === undefined ? ["it has never been read again"] : wait.reviewed.slice(0, 10) < due ? [`it was last read again on ${wait.reviewed.slice(0, 10)}`] : []),
      ];
      return { wait, increment, arc: view.arc, reasons };
    })
    .filter(({ reasons }) => reasons.length > 0)));
  if (found.length === 0) return { text: "No action of yours needs attention." };
  found.sort((one, other) => (one.wait.reviewed ?? "").localeCompare(other.wait.reviewed ?? ""));
  const lines = found.flatMap(({ wait, increment, arc, reasons }) => [
    `  - ${increment.id}  ${increment.fields.title}, on ${arc.id}  ${arc.fields.title}: ${reasons.join("; ")}`,
    `      ${wait.rank === undefined ? "" : `#${wait.rank}  `}${wait.note}${wait.why === undefined ? "" : ` (why: ${wait.why})`}`,
  ]);
  return {
    text: [`${found.length} ${found.length === 1 ? "action" : "actions"} of yours ${found.length === 1 ? "needs" : "need"} attention, oldest read first:`, ...lines].join("\n"),
    next: [{ command: "arc increment wait <increment> --for owner [--note …] [--why …] [--rank <n>]", why: "rewrite its note, give it a why or a rank; written again, it reads as read again today" }],
  };
}

const increment: VerbFamilies<ArcVerbContext> = {
  name: "increment",
  summary: "the increments of an arc's work",
  verbs: [incrementNew, incrementAdd, incrementClose, incrementCorrectClosure, incrementEdit, incrementUnstart, incrementMove, incrementSettlePending, incrementApplyPending, incrementDropPending, incrementWait, incrementUnwait],
  guesses: { show: "library read <id>", read: "library read <id>", get: "library read <id>", open: "library read <id>" },
  retired: {
    ready: { why: "ADR-0909 retired the increment's ready step, and claiming a proposal starts it.", instead: "workspace <increment> --reason …" },
  },
};

export const ARC_VERBS = [readsElsewhere(show), readsElsewhere(list), readsAcross(waits), status, recent, create, edit, park, unpark, arcWait, arcUnwait];
export const ARC_INNER = [increment];

export const ARC_GUESSES: Readonly<Record<string, string>> = { read: "arc show <arc>", get: "arc show <arc>", open: "arc show <arc>" };

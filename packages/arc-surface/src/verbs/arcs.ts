/**
 * Capability 3 · Arc surface. The `arc` verbs and the `arc increment` family within them, declared here (ADR-0969 D2)
 * and mounted by the command line as its `arc` family (ADR-1033): see one arc whole, its intent, end state, increments
 * and their states, the questions waiting on the owner, what each waiting item waits for, and each open increment's
 * pending plan changes (ADR-0966 D3); and every wait for the owner or an outside event across arcs. Create, edit, park
 * or unpark an arc; park an increment, record a landing that was never parked, close one with its outcome, move one to
 * another arc keeping its id, and make an arc or increment wait on another with a reason, or an increment wait for the
 * owner or an outside event with a note (ADR-0938 D1), or clear the wait (the library clears one itself when its
 * blocker lands or closes, 11.8). Return active work nobody holds to proposal (`increment unstart`), and settle the
 * pending plan changes closed increments left behind (`increment settle-pending`), or drop one an open increment holds
 * that something else overtook (`increment drop-pending`). Closing an increment ends its claims
 * through Session management's `closed`, and is refused while another session holds it live (its `closeRefusal`). None is a tool: the MCP server's own show_plan, park_increment, edit_plan,
 * move_increment, close_increment, set_wait and clear_wait do these jobs.
 *
 * Every rule is the library's (its capabilities 10, 11 and 12): an arc's intent and end state, a close's note, the loop
 * check, whether a wait holds (`waitHolds`) and whether work is held on the owner (`heldOnQuestion`), and an arc's
 * state, which `arcView` works out. There is no `increment start` (starting is claiming, the agent tools'), no
 * `increment ready` (ADR-0645 D5; ADR-0909 D4 retired the step, and the word is refused saying so), and no hand close
 * or re-open of an arc (the owner's R1). `arc list` reads the board's arcs: live ones and those closed yesterday or today, or a window's closed arcs.
 * `arc status` (status.ts) says, for every active arc, whether it is moving and why not; `arc recent` (recent.ts) what
 * landed since a time, by arc.
 */
import { verb, VerbRefusal, type VerbFamilies } from "@storytree/library/verbs";
import { beforeCutover, pullSaid, type ArcView, type Holds, type NoteWait, type PendingChange, type WaitFor } from "@storytree/library";

import { recentWindow, windowOf, type ClosedRange } from "../board/closed-range.js";
import { questionsBehind } from "../work-states/board-states.js";
import { labelOf, listOf, releasedAsking, type ArcVerbContext } from "./context.js";
import { recent } from "./recent.js";
import { status } from "./status.js";

const NO_TOOL = "the MCP server's own plan tools do this";

/** The given values among `given`, each under the library field it names (`end-state` is `endState`), kept as the text given. */
function fieldsOf(given: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(given)) if (value !== undefined) fields[name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  return fields;
}

/** `--priority <n|none>` (ADR-0963 D3): a whole number of 1 or more, or `none`, which clears it; not given, nothing. */
function priorityOf(value: string | undefined): { priority?: number | undefined } {
  if (value === undefined) return {};
  if (value === "none") return { priority: undefined };
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new VerbRefusal(`--priority is a whole number of 1 or more (1 first), or none to clear it; not "${value}"`);
  return { priority: Number(value) };
}

/** An arc's priority as said: 1 first, and an arc with none comes after every arc that has one (ADR-0963 D1). */
const rankOf = (view: Pick<ArcView, "arc">): number => view.arc.fields.priority ?? Infinity;

/** An increment's pending changes (ADR-0966 D3): each record, then each field as before -> after, or its retirement. */
function pendingSaid(pending: readonly PendingChange[]): string[] {
  const said = (value: unknown): string => (value === null || value === undefined ? "(none)" : typeof value === "string" ? value : JSON.stringify(value));
  return [
    `Pending changes (${pending.length}), applied when its branch merges:`,
    ...pending.flatMap((change) => [
      `  ${change.record}  [${change.type}]  read at history entry ${change.base}`,
      ...("retire" in change ? [`    retire: ${change.retire}`] : Object.entries(change.after).map(([field, value]) => `    ${field}: ${said(change.before[field])} -> ${said(value)}`)),
    ]),
  ];
}

/**
 * Why an open increment cannot start yet, from one reading of every hold: the blockers holding it, the owner's questions
 * it is held on or its waits on other work end on, and what it waits for outside the plan (ADR-0938 D1).
 */
function holdsOn(holds: Holds, id: string): string[] {
  const lines: string[] = [];
  for (const hold of holds.waits[id] ?? []) {
    lines.push(`waits on ${hold.on}: ${hold.reason}${hold.forGood ? " (never releases: the blocker did not land, or is gone)" : ""}`);
  }
  for (const question of holds.heldOn[id] ?? []) lines.push(`waiting on you: question ${question}`);
  // Work it waits on is held on your question, however many hops away, so it waits on you too.
  for (const question of questionsBehind(id, holds)) lines.push(`waiting on you: question ${question} (through other work)`);
  for (const wait of holds.waitsFor?.[id] ?? []) lines.push(waitSaid(wait));
  return lines;
}

/** A wait for the owner or an outside event, as `arc show` names it under its increment: an event's reads passed from its check-back day. */
function waitSaid({ releaser, note, checkBack, holds }: NoteWait): string {
  if (releaser === "owner") return `waiting on you: ${note}`;
  return holds ? `waits for an event: ${note} (check back ${checkBack})` : `check-back passed ${checkBack}: ${note}`;
}

/** An arc's state as said: "parked until <day>" while a dated park holds (the owner's, or its work's check-back), its state otherwise. */
function stateOf({ state, wakes }: Pick<ArcView, "state" | "wakes">): string {
  return state === "parked" && wakes !== undefined ? `parked until ${wakes} (UTC)` : state;
}

const show = verb({
  command: { family: "arc", name: "show", summary: "one arc whole: intent, end state, increments, what each waits for, and your questions" },
  tool: { absent: "the MCP server's own show_plan shows the plan" },
  inputs: { arc: { kind: "text", word: 0, describe: "the arc's id" } },
  async act({ arc: id }, { library }: ArcVerbContext) {
    // Every hold in one ask, never one per increment: each ask reads all the project's work (4.8).
    const [view, holds, cutover] = await Promise.all([library.arcView(id), library.holds(), library.prCutover()]);
    if (view === null) throw new VerbRefusal(`no arc "${id}" in this project`);
    const { arc, state, increments, questions } = view;
    const lines = [`${arc.fields.title}  [${arc.id}]  ${stateOf(view)}`, "", `Intent: ${arc.fields.intent}`, `End state: ${arc.fields.endState}`];
    if (arc.fields.priority !== undefined) lines.push(`Priority: ${arc.fields.priority}`);
    for (const line of holdsOn(holds, arc.id)) lines.push(`This arc ${line}`);
    const open = increments.filter((increment) => increment.fields.status !== "closed");
    const closed = increments.filter((increment) => increment.fields.status === "closed");
    lines.push("", `Work (${open.length} open)`);
    if (open.length === 0) lines.push("  (none)");
    for (const increment of open) {
      lines.push(`  - ${increment.id}  [${increment.fields.status}]  ${increment.fields.title}`);
      for (const line of holdsOn(holds, increment.id)) lines.push(`      ${line}`);
      if ((increment.fields.pending ?? []).length > 0) for (const line of pendingSaid(increment.fields.pending!)) lines.push(`      ${line}`);
    }
    const waiting = questions.filter((question) => question.fields.lifecycle === "open");
    // A parked arc's questions are parked with it until it is unparked (ADR-0835 D2).
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
      // A pull request closed before the repository cut-over is the old repository's, and says so.
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

/** Who releases a wait for something outside the plan, in words. */
function releasedBy(releaser: WaitFor["releaser"]): string {
  return releaser === "owner" ? "the owner" : "an outside event";
}

/** What `--for` names an increment waiting for outside the plan, or undefined for a wait `--on` other work: exactly one of the two is given. */
function releaserOf(on: string | undefined, releaser: string | undefined): WaitFor["releaser"] | undefined {
  if ((on !== undefined) === (releaser !== undefined)) throw new VerbRefusal("give exactly one of --on and --for", { misuse: true });
  if (releaser === undefined || releaser === "owner" || releaser === "event") return releaser;
  throw new VerbRefusal(`--for is owner or event, not "${releaser}"`, { misuse: true });
}

/** A flag a verb needs in the form it was given: an arc's wait needs its `--reason`, an increment's owner wait its `--note`. */
function needed(value: string | undefined, name: string): string {
  if (value === undefined) throw new VerbRefusal(`this needs --${name}`, { misuse: true });
  return value;
}

/**
 * Make an arc or increment wait on another, or clear the wait: the library's addWait and removeWait, which take either.
 * An increment can instead wait for the owner or an outside event, with a note (`--for`): its addWaitFor and
 * removeWaitFor, whose refusals are the library's (ADR-0938 D1).
 */
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
  command: { family: "arc", name: "unwait", summary: "clear a wait", usage: "arc unwait <arc> --on <arc|increment>" },
  tool: { absent: NO_TOOL },
  inputs: { arc: { kind: "text", word: 0, describe: "the arc's id" }, on: { kind: "text", optional: true, describe: "the arc or increment it waits on" } },
  writes: true,
  async act({ arc: id, on }, context: ArcVerbContext) {
    const blocker = needed(on, "on");
    const done = await context.library.removeWait(id, blocker, context.writer);
    if (done === null) throw new VerbRefusal(`no arc "${id}" in this project`);
    return { text: `${id} no longer waits on ${blocker}.` };
  },
});

const incrementWait = verb({
  command: {
    family: "arc increment",
    name: "wait",
    summary: "make an increment wait on another, with a reason; or for you, or an outside event until a check-back day, with a note",
    usage: "arc increment wait <increment> --on <increment> --reason <why>, or --for owner|event --note <text|@file> [--check-back YYYY-MM-DD]",
  },
  tool: { absent: NO_TOOL },
  inputs: {
    increment: { kind: "text", word: 0, describe: "the increment's id" },
    on: { kind: "text", optional: true, describe: "the increment it waits on" },
    reason: { kind: "text", optional: true, describe: "why" },
    for: { kind: "text", optional: true, describe: "owner or event" },
    note: { kind: "text", optional: true, describe: "what it waits for" },
    "check-back": { kind: "text", optional: true, describe: "the day to check back, for an event" },
  },
  writes: true,
  async act({ increment: id, on, reason, for: waitingFor, note, "check-back": checkBack }, context: ArcVerbContext) {
    const releaser = releaserOf(on, waitingFor);
    if (releaser !== undefined) {
      const said = needed(note, "note");
      const done = await context.library.addWaitFor(id, { releaser, note: said, ...(checkBack === undefined ? {} : { checkBack }) }, context.writer);
      if (done === null) throw new VerbRefusal(`no increment "${id}" in this project`);
      // Waiting on the owner releases the caller's claims on it, as raising a question does (ADR-0944 D4); an event releases nothing.
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
    summary: "clear a wait; clearing one for you to finish the increment yourself, --claim claims it first, so the pool never starts it in between",
    usage: "arc increment unwait <increment> --on <increment>, or --for owner|event, or --for owner --claim <reason>",
  },
  tool: { absent: NO_TOOL },
  inputs: {
    increment: { kind: "text", word: 0, describe: "the increment's id" },
    on: { kind: "text", optional: true, describe: "the increment it waits on" },
    for: { kind: "text", optional: true, describe: "owner or event" },
    claim: { kind: "text", optional: true, describe: "with --for owner, when this session finishes it: the claim's reason, taken before the wait clears" },
  },
  writes: true,
  async act({ increment: id, on, for: waitingFor, claim }, context: ArcVerbContext) {
    const releaser = releaserOf(on, waitingFor);
    if (claim !== undefined) {
      if (releaser !== "owner") throw new VerbRefusal("--claim goes with --for owner", { misuse: true });
      if (context.session.startsWith("person:")) throw new VerbRefusal("Run it from the agent's shell: a claim belongs to the agent session that will finish the work.");
      // Claimed first, through the owner wait, then cleared: it never reads ready and unclaimed in between (5.57).
      const { claimClearingOwnerWait } = await import("@storytree/session-management/tools");
      const { workspaceRefusalText } = await import("@storytree/session-management/workspace-verbs");
      const answer = await claimClearingOwnerWait(context, id, claim);
      if (!answer.ok) throw new VerbRefusal(`${workspaceRefusalText(id, answer)} Its wait for the owner stands.`);
      return { text: `${id} no longer waits for the owner, and ${context.session} holds it: ${claim}.` };
    }
    if (releaser !== undefined) {
      const done = await context.library.removeWaitFor(id, releaser, context.writer);
      if (done === null) throw new VerbRefusal(`no increment "${id}" in this project`);
      // Nobody holds it now, so the pool may start a lane on it (5.57).
      const ready = releaser === "owner" ? " Nobody holds it, so the pool may start it now: to finish it yourself, clear it with --claim <reason> instead." : "";
      return { text: `${id} no longer waits for ${releasedBy(releaser)}.${ready}` };
    }
    const done = await context.library.removeWait(id, on!, context.writer);
    if (done === null) throw new VerbRefusal(`no increment "${id}" in this project`);
    return { text: `${id} no longer waits on ${on}.` };
  },
});

const PLAN_INPUTS = {
  arc: { kind: "text", optional: true, describe: "the arc it is on" },
  title: { kind: "text", optional: true, describe: "its title" },
  objective: { kind: "text", optional: true, describe: "what it delivers" },
  body: { kind: "text", optional: true, describe: "its breakdown" },
  capabilities: { kind: "text", optional: true, describe: "the capabilities it changes, comma-separated" },
  links: { kind: "text", optional: true, describe: "what it cites, comma-separated" },
  remedies: { kind: "text", optional: true, describe: "the friction it remedies, comma-separated" },
  "held-on": { kind: "text", optional: true, blank: true, describe: "the owner's questions it is held on, comma-separated, or none to clear" },
  machine: { kind: "text", optional: true, describe: "the one machine that can take it, or none to clear" },
  "escape-of": { kind: "text", optional: true, describe: "the pull request (#123) or increment that caused the escape it fixes, or none to clear" },
  "escape-story": { kind: "text", optional: true, describe: "the story that escape hit, with --escape-of" },
  touches: { kind: "text", optional: true, describe: "retired: --capabilities and --links" },
} as const;

type PlanGiven = { readonly [K in keyof typeof PLAN_INPUTS]?: string | undefined };

/** A new or edited increment's fields, as given. `--touches` is retired (ADR-0949 D2), and refused rather than ignored. */
function incrementOf({ capabilities, links, remedies, "held-on": heldOn, machine: _machine, "escape-of": escapeOf, "escape-story": escapeStory, touches, ...rest }: PlanGiven): Record<string, unknown> {
  if (touches !== undefined) {
    throw new VerbRefusal("--touches is retired (ADR-0949 D2): name the capabilities it changes with --capabilities, and cite its stories or anything else with --links", { misuse: true });
  }
  const fields: Record<string, unknown> = fieldsOf(rest);
  for (const [flag, field, value] of [["capabilities", "capabilities", capabilities], ["links", "links", links], ["remedies", "remedies", remedies], ["held-on", "heldOn", heldOn]] as const) {
    const list = listOf(value, flag);
    if (list !== undefined) fields[field] = list;
  }
  // `--held-on none`, or an empty value where the shell delivers one (Windows PowerShell 5.1 drops it),
  // clears the hold, as settling or retiring its last question does.
  const held = fields.heldOn as string[] | undefined;
  if (held?.length === 0 || (held?.length === 1 && held[0] === "none")) fields.heldOn = undefined;
  // The escape it fixes: what caused it and the story it hit, given together; `--escape-of none` clears it.
  if (escapeOf === "none" && escapeStory === undefined) fields.escape = undefined;
  else if (escapeOf !== undefined && escapeStory !== undefined) fields.escape = { causedBy: escapeOf, story: escapeStory };
  else if (escapeOf !== undefined || escapeStory !== undefined) {
    throw new VerbRefusal("--escape-of and --escape-story go together: the pull request or increment that caused the escape, and the story it hit (or --escape-of none alone to clear it)", { misuse: true });
  }
  return fields;
}

/**
 * `--machine <name|none>`: the one machine that can take the increment, checked by Session management's Machines
 * (`incrementMachine`): a named machine's name, or `none`, which clears it; not given, nothing.
 */
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

const INCREMENT_USAGE = "--arc <arc> --title <t> --objective <o> --body <text|@file> [--capabilities a,b] [--links a,b] [--remedies a,b] [--held-on q] [--machine <name>] [--escape-of <pr|increment> --escape-story <story>]";

const CLOSE_INPUTS = {
  disposition: { kind: "text", optional: true, describe: "landed, failed or withdrawn" },
  pr: { kind: "text", optional: true, describe: "its pull request" },
  note: { kind: "text", optional: true, describe: "why" },
  date: { kind: "text", optional: true, describe: "the day it closed, YYYY-MM-DD" },
} as const;

/** An increment's close, as given: its outcome, its pull request kept as the text given (`--pr 132` is "132"). */
function closeOf(given: { disposition?: string | undefined; pr?: string | undefined; note?: string | undefined; date?: string | undefined }): { disposition: never; pr?: string; note?: string; date?: string } {
  return fieldsOf(given) as never;
}

const incrementNew = verb({
  command: { family: "arc increment", name: "new", summary: "park an increment on an arc, as a proposal", usage: `arc increment new ${INCREMENT_USAGE} [--waits-on a,b --wait-reason <why>] [--wait-for owner --wait-note <text|@file>]` },
  tool: { absent: NO_TOOL },
  inputs: {
    ...PLAN_INPUTS,
    "waits-on": { kind: "text", optional: true, describe: "the increments it is born waiting on, comma-separated" },
    "wait-reason": { kind: "text", optional: true, describe: "why it waits on them" },
    "wait-for": { kind: "text", optional: true, describe: "owner: it is born waiting for you" },
    "wait-note": { kind: "text", optional: true, describe: "with --wait-for owner: what you must do before it can start" },
  },
  writes: true,
  async act({ "waits-on": waitsOn, "wait-reason": reason, "wait-for": waitFor, "wait-note": waitNote, ...given }, context: ArcVerbContext) {
    // `--waits-on a,b --wait-reason <why>`: the increments a new one is born waiting on, all for the one reason; neither given, none.
    const on = listOf(waitsOn, "waits-on");
    if ((on !== undefined || reason !== undefined) && (on === undefined || on.length === 0 || reason === undefined)) {
      throw new VerbRefusal("--waits-on and --wait-reason go together: the increments it waits on, and why", { misuse: true });
    }
    const waits = on === undefined ? {} : { waits: on.map((id) => ({ on: id, reason: reason! })) };
    // `--wait-for owner --wait-note <what>`: born waiting for the owner in the parking's one write, so the pool never reads it ready in between.
    if ((waitFor !== undefined || waitNote !== undefined) && (waitFor !== "owner" || waitNote === undefined)) {
      throw new VerbRefusal("--wait-for owner and --wait-note go together: a new increment is born waiting only for you, with what you must do (an event wait is set after, with `arc increment wait`)", { misuse: true });
    }
    const waitsFor = waitNote === undefined ? {} : { waitsFor: [{ releaser: "owner" as const, note: waitNote }] };
    const increment = await context.library.addIncrement({ ...incrementOf(given), ...waits, ...waitsFor, ...(await machineGiven(given.machine, context)) } as never, context.writer);
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
    const holder = (await readClaims(context.log, context.project)).find((claim) => claim.increment === id);
    if (holder !== undefined) throw new VerbRefusal(`${id} is held by ${holder.label} session ${holder.session} (${holder.reason}): it is work in progress. Its holder releases it, which returns it to proposal.`);
    await library.returnIncrement(id, context.writer);
    return { text: `${id} is a proposal again: nobody holds it.`, next: [{ command: `arc show ${(increment.fields as { arc: string }).arc}`, why: "see the arc" }] };
  },
});

const incrementEdit = verb({
  command: {
    family: "arc increment",
    name: "edit",
    summary: "change only the named fields; --capabilities and --links replace the lists, --remedies adds friction to those it already remedies, --machine names the one machine that can take it, --escape-of and --escape-story the escape it fixes",
    usage: "arc increment edit <increment> [--title …] [--objective …] [--body …] [--capabilities a,b] [--links a,b] [--remedies f,g] [--held-on q, or none to clear] [--machine <name>, or none to clear] [--escape-of <pr|increment> --escape-story <story>, or --escape-of none to clear]",
  },
  tool: { absent: "the MCP server's own edit_plan edits an increment" },
  inputs: { increment: { kind: "text", word: 0, describe: "the increment's id" }, ...PLAN_INPUTS },
  writes: true,
  async act({ increment: id, ...given }, context: ArcVerbContext) {
    const { library } = context;
    const fields: Record<string, unknown> = { ...incrementOf(given), ...(await machineGiven(given.machine, context)) };
    if (fields.remedies !== undefined) {
      const had = ((await library.get(id))?.fields as { remedies?: string[] } | undefined)?.remedies ?? [];
      fields.remedies = [...new Set([...had, ...(fields.remedies as string[])])];
    }
    if (fields.capabilities !== undefined) await refuseShared(id, fields.capabilities as string[], context);
    const edited = await library.editIncrement(id, fields as never, context.writer);
    if (edited === null) throw new VerbRefusal(`no increment "${id}" in this project`);
    return { text: `Edited increment ${id}.` };
  },
});

/**
 * Refuses `capabilities` as `target`'s list when one is on the list of an increment another live session holds: two
 * sessions never plan changes to the same capability (ADR-0949 D2), as edit_plan refuses. An entry whose capability
 * another session's live claim holds is left behind by a lane that backed off from it (ADR-0944 D3), and refuses nothing.
 */
async function refuseShared(target: string, capabilities: readonly string[], context: ArcVerbContext): Promise<void> {
  const { readClaims } = await import("@storytree/session-management");
  const claims = await readClaims(context.log, context.project);
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
  command: { family: "arc increment", name: "move", summary: "re-home an increment on another live arc, keeping its identity and lifecycle" },
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

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The closing days `arc list` reads closed arcs by, as the sessions History tab's presets and From–to (3.12): none given,
 * none (the board's routine read, yesterday and today, lists them beside the live arcs); a preset, or both days of a
 * From–to, both ends included.
 */
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
    // The board's reads (10.22): live arcs and the recently closed in one ask, or a window's closed arcs alone in one.
    const read = range === undefined ? await library.boardArcs(recentWindow(now)) : await library.closedArcs(windowOf(range, now));
    // A stable sort: within one priority, and among the unranked, the order is the library's.
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

const waits = verb({
  command: { family: "arc", name: "waits", summary: "every open increment's waits for you or an outside event, across arcs: yours first, then events by check-back day" },
  tool: { absent: "the MCP server's own show_plan names what waits" },
  inputs: {},
  async act(_input, { library }: ArcVerbContext) {
    // Every hold in one ask and every arc in one more, never a read per increment (4.10).
    const [views, holds] = await Promise.all([library.arcViews(), library.holds()]);
    const found = views.flatMap(({ arc, increments }) =>
      increments.flatMap((increment) => (holds.waitsFor?.[increment.id] ?? [])
        // A wait for you on work that still waits on open work is not yours yet: it is listed once that work lands.
        .filter((wait) => wait.releaser !== "owner" || !(holds.waits[increment.id] ?? []).length)
        .map((wait) => ({ wait, increment, arc }))));
    // A parked arc asks nothing of the owner until it is unparked (ADR-0835 D2): its waits for you are counted, not listed.
    const parkedArcs = new Set(views.flatMap((view) => (view.state === "parked" ? [view.arc.id] : [])));
    const shelved = found.filter(({ wait, arc }) => wait.releaser === "owner" && parkedArcs.has(arc.id));
    const holding = [...new Set(shelved.map(({ arc }) => arc.id))];
    const aside = shelved.length === 0
      ? []
      : [`${shelved.length} more for you ${shelved.length === 1 ? "waits" : "wait"} on a parked arc until it is unparked: ${holding.join(", ")} (storytree arc show <arc> names them).`];
    const listed = found.filter((one) => !shelved.includes(one));
    if (listed.length === 0) return { text: ["No waits for you or an outside event.", ...aside].join("\n") };
    // An owner wait has no day, so it sorts before every event; the sort keeps arc order within a day.
    listed.sort((one, other) => (one.wait.checkBack ?? "").localeCompare(other.wait.checkBack ?? ""));
    const lines = listed.map(({ wait, increment, arc }) => {
      const day = wait.releaser === "event" ? `; check back ${wait.checkBack}${wait.holds ? "" : ", overdue"}` : "";
      return `  - ${wait.releaser === "owner" ? "you  " : "event"}  ${wait.note} — ${increment.id}  ${increment.fields.title}, on ${arc.id}  ${arc.fields.title}${day}`;
    });
    return {
      text: [`${listed.length} ${listed.length === 1 ? "wait" : "waits"} for you or an outside event:`, ...lines, ...aside].join("\n"),
      next: [{ command: "arc show <arc>", why: "see a wait's arc whole" }],
    };
  },
});

const increment: VerbFamilies<ArcVerbContext> = {
  name: "increment",
  summary: "the increments of an arc's work",
  verbs: [incrementNew, incrementAdd, incrementClose, incrementCorrectClosure, incrementEdit, incrementUnstart, incrementMove, incrementSettlePending, incrementDropPending, incrementWait, incrementUnwait],
  guesses: { show: "library read <id>", read: "library read <id>", get: "library read <id>", open: "library read <id>" },
  retired: {
    ready: { why: "ADR-0909 retired the increment's ready step, and claiming a proposal starts it.", instead: "workspace <increment> --reason …" },
  },
};

/** The arc verbs, as the command line's `arc` family lists them, and the `arc increment` family within it. */
export const ARC_VERBS = [show, list, waits, status, recent, create, edit, park, unpark, arcWait, arcUnwait];
export const ARC_INNER = [increment];

/** Words agents try for seeing one arc. */
export const ARC_GUESSES: Readonly<Record<string, string>> = { read: "arc show <arc>", get: "arc show <arc>", open: "arc show <arc>" };

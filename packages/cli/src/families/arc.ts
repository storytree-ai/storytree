/**
 * Capability 4 · Arcs and increments (the command line story): see one arc whole, its intent, end state,
 * increments and their states, the questions waiting on the owner, and what each waiting item
 * waits for; and every wait for the owner or an outside event across arcs. Create, edit, park or
 * unpark an arc; park an increment, record a landing that was never parked, close one with its
 * outcome, move one to another arc keeping its id, and make an arc or increment wait on another
 * with a reason, or an increment wait for the owner or an outside event with a note (ADR-0938 D1),
 * or clear the wait. Closing an increment ends its claims through the agent link's `closed`.
 *
 * Every rule is the library's (its capabilities 10, 11 and 12): an arc's intent and end state, a
 * close's note, the loop check, whether a wait holds (`waitHolds`) and whether work is held on the
 * owner (`heldOnQuestion`), and an arc's state, which `arcView` works out. There is no `increment
 * start` (starting is claiming, the agent tools'), no `increment ready` (ADR-0645 D5; ADR-0909 D4 retired the step, and the word is refused saying so), and no hand
 * close or re-open of an arc (the owner's R1). `arc list` reads list(kind), then each arc's view.
 */
import type { ArcView, Holds, NoteWait, WaitFor } from "@storytree/library";

import { labelOf, Refusal, type Answer } from "../answer.js";
import { commaSeparatedIds, type Args } from "../args.js";
import type { Family, Verb } from "../door.js";
import { valueOf } from "./library.js";

/** The given flags among `names`, each as the library field it names (`--end-state` is `endState`), kept as the text given (`--pr 132` is "132", not a number). */
function given(args: Args, names: readonly string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const name of names) {
    const value = args.text(name);
    if (value !== undefined) fields[name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  }
  return fields;
}

/** A list flag: `--touches a,b` or `--touches '["a","b"]'`, or undefined when not given. */
function listOf(args: Args, name: string): string[] | undefined {
  const value = args.text(name);
  if (value === undefined) return undefined;
  const parsed = valueOf(value);
  return Array.isArray(parsed) ? (parsed as string[]) : commaSeparatedIds(value, name);
}

const ARC_FIELDS = ["title", "intent", "end-state", "description"] as const;
const INCREMENT_FIELDS = ["title", "objective", "body"] as const;

/** An increment's close, as given: its outcome. */
function closeOf(args: Args): { disposition: never; pr?: string; note?: string; date?: string } {
  return given(args, ["disposition", "pr", "note", "date"]) as never;
}

/**
 * Why an open increment cannot start yet, from one reading of every hold: the blockers holding it,
 * the owner's questions it is held on, and what it waits for outside the plan (ADR-0938 D1).
 */
function holdsOn(holds: Holds, id: string): string[] {
  const lines: string[] = [];
  for (const hold of holds.waits[id] ?? []) {
    lines.push(`waits on ${hold.on}: ${hold.reason}${hold.forGood ? " (never releases: the blocker did not land, or is gone)" : ""}`);
  }
  for (const question of holds.heldOn[id] ?? []) lines.push(`waiting on you: question ${question}`);
  for (const wait of holds.waitsFor?.[id] ?? []) lines.push(waitSaid(wait));
  return lines;
}

/** A wait for the owner or an outside event, as `arc show` names it under its increment: an event's reads passed from its check-back day. */
function waitSaid({ releaser, note, checkBack, holds }: NoteWait): string {
  if (releaser === "owner") return `waiting on you: ${note}`;
  return holds ? `waits for an event: ${note} (check back ${checkBack})` : `check-back passed ${checkBack}: ${note}`;
}

const show: Verb = {
  name: "show",
  usage: "arc show <arc>",
  summary: "one arc whole: intent, end state, increments, what each waits for, and your questions",
  async act(args, context) {
    const id = args.word(0, "the arc's id", this.usage);
    const library = await context.library();
    // Every hold in one ask, never one per increment: each ask reads all the project's work (4.8).
    const [view, holds] = await Promise.all([library.arcView(id), library.holds()]);
    if (view === null) throw new Refusal(`no arc "${id}" in this project`);
    const { arc, state, increments, questions } = view;
    const lines = [`${arc.fields.title}  [${arc.id}]  ${stateOf(view)}`, "", `Intent: ${arc.fields.intent}`, `End state: ${arc.fields.endState}`];
    for (const line of holdsOn(holds, arc.id)) lines.push(`This arc ${line}`);
    const open = increments.filter((increment) => increment.fields.status !== "closed");
    const closed = increments.filter((increment) => increment.fields.status === "closed");
    lines.push("", `Work (${open.length} open)`);
    if (open.length === 0) lines.push("  (none)");
    for (const increment of open) {
      lines.push(`  - ${increment.id}  [${increment.fields.status}]  ${increment.fields.title}`);
      for (const line of holdsOn(holds, increment.id)) lines.push(`      ${line}`);
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
      const how = [outcome?.date, outcome?.disposition, outcome?.pr].filter((part) => part !== undefined).join("  ");
      lines.push(`  - ${how}  ${increment.id}  ${increment.fields.title}`);
      if (outcome?.note !== undefined) lines.push(`      ${outcome.note}`);
    }
    return { text: lines.join("\n") };
  },
};

const create: Verb = {
  name: "new",
  usage: "arc new --title <t> --intent <text|@file> --end-state <text|@file> [--stories a,b]",
  summary: "a new arc, whole: its intent and end state",
  async act(args, context) {
    const stories = listOf(args, "stories");
    const arc = await (await context.library()).createArc({ ...given(args, ARC_FIELDS), ...(stories === undefined ? {} : { stories }) } as never, context.writer());
    return { text: `Created arc ${arc.id}.`, next: [{ command: `storytree arc show ${arc.id}`, why: "see it whole" }] };
  },
};

const edit: Verb = {
  name: "edit",
  usage: "arc edit <arc> [--title …] [--intent …] [--end-state …] [--stories a,b]",
  summary: "change only the named fields",
  async act(args, context) {
    const id = args.word(0, "the arc's id", this.usage);
    const stories = listOf(args, "stories");
    const edited = await (await context.library()).editArc(id, { ...given(args, ARC_FIELDS), ...(stories === undefined ? {} : { stories }) } as never, context.writer());
    if (edited === null) throw new Refusal(`no arc "${id}" in this project`);
    return { text: `Edited arc ${id}.`, next: [{ command: `storytree arc show ${id}`, why: "see it whole" }] };
  },
};

function parking(name: "park" | "unpark"): Verb {
  return {
    name,
    usage: name === "park" ? "arc park <arc> [--until YYYY-MM-DD]" : "arc unpark <arc>",
    summary: name === "park" ? "hold an arc: it reads parked until unparked, or until the day given (UTC midnight)" : "take an arc off hold",
    async act(args, context) {
      const id = args.word(0, "the arc's id", this.usage);
      const until = name === "park" ? args.text("until") : undefined;
      const library = await context.library();
      const done = name === "park" ? await library.parkArc(id, { ...context.writer(), ...(until === undefined ? {} : { until }) }) : await library.unparkArc(id, context.writer());
      if (done === null) throw new Refusal(`no arc "${id}" in this project`);
      return { text: `${name === "park" ? "Parked" : "Unparked"} arc ${id}${until === undefined ? "" : ` until ${until} (it wakes at UTC midnight)`}.` };
    },
  };
}

/** An arc's state as said: "parked until <day>" while a dated park holds, its state otherwise. */
function stateOf({ arc, state }: ArcView): string {
  return state === "parked" && arc.fields.parkedUntil !== undefined ? `parked until ${arc.fields.parkedUntil} (UTC)` : state;
}

/**
 * Make an arc or increment wait on another, or clear the wait: the library's addWait and removeWait,
 * which take either. An increment can instead wait for the owner or an outside event, with a note
 * (`--for`): its addWaitFor and removeWaitFor, whose refusals are the library's (ADR-0938 D1).
 */
function waiting(family: string, what: "arc" | "increment"): Verb[] {
  const outside = what === "increment";
  return [
    {
      name: "wait",
      usage: `${family} wait <${what}> --on <${what}> --reason <why>${outside ? ", or --for owner|event --note <text|@file> [--check-back YYYY-MM-DD]" : ""}`,
      summary: outside
        ? "make an increment wait on another, with a reason; or for you, or an outside event until a check-back day, with a note"
        : "make an arc wait on another, with a reason",
      async act(args, context) {
        const id = args.word(0, `the ${what}'s id`, this.usage);
        const releaser = outside ? releaserOf(args, this.usage) : undefined;
        if (releaser !== undefined) {
          const note = args.need("note", this.usage).trim();
          const checkBack = args.text("check-back");
          const wait = { releaser, note, ...(checkBack === undefined ? {} : { checkBack }) };
          const done = await (await context.library()).addWaitFor(id, wait, context.writer());
          if (done === null) throw new Refusal(`no increment "${id}" in this project`);
          return { text: `${id} now waits for ${releasedBy(releaser)}: ${note}${checkBack === undefined ? "" : ` (check back ${checkBack})`}.` };
        }
        const on = args.need("on", this.usage);
        const done = await (await context.library()).addWait(id, on, args.need("reason", this.usage), context.writer());
        if (done === null) throw new Refusal(`no ${what} "${id}" in this project`);
        return { text: `${id} now waits on ${on}.` };
      },
    },
    {
      name: "unwait",
      usage: `${family} unwait <${what}> --on <${what}>${outside ? ", or --for owner|event" : ""}`,
      summary: "clear a wait",
      async act(args, context) {
        const id = args.word(0, `the ${what}'s id`, this.usage);
        const releaser = outside ? releaserOf(args, this.usage) : undefined;
        if (releaser !== undefined) {
          const done = await (await context.library()).removeWaitFor(id, releaser, context.writer());
          if (done === null) throw new Refusal(`no increment "${id}" in this project`);
          return { text: `${id} no longer waits for ${releasedBy(releaser)}.` };
        }
        const on = args.need("on", this.usage);
        const done = await (await context.library()).removeWait(id, on, context.writer());
        if (done === null) throw new Refusal(`no ${what} "${id}" in this project`);
        return { text: `${id} no longer waits on ${on}.` };
      },
    },
  ];
}

/** What `--for` names an increment waiting for outside the plan, or undefined for a wait `--on` other work: exactly one of the two is given. */
function releaserOf(args: Args, usage: string): WaitFor["releaser"] | undefined {
  const releaser = args.text("for");
  if (args.has("on") === (releaser !== undefined)) throw new Refusal(`give exactly one of --on and --for\nusage: storytree ${usage}`, { code: 2 });
  if (releaser === undefined || releaser === "owner" || releaser === "event") return releaser;
  throw new Refusal(`--for is owner or event, not "${releaser}"\nusage: storytree ${usage}`, { code: 2 });
}

/** Who releases a wait for something outside the plan, in words. */
function releasedBy(releaser: WaitFor["releaser"]): string {
  return releaser === "owner" ? "the owner" : "an outside event";
}

/** A new increment's fields, as given. */
function incrementOf(args: Args): Record<string, unknown> {
  const fields: Record<string, unknown> = given(args, ["arc", ...INCREMENT_FIELDS]);
  for (const [flag, field] of [["touches", "touches"], ["remedies", "remedies"], ["held-on", "heldOn"]] as const) {
    const list = listOf(args, flag);
    if (list !== undefined) fields[field] = list;
  }
  return fields;
}

const INCREMENT_USAGE = "--arc <arc> --title <t> --objective <o> --body <text|@file> [--touches a,b] [--remedies a,b] [--held-on q]";

const incrementNew: Verb = {
  name: "new",
  usage: `arc increment new ${INCREMENT_USAGE}`,
  summary: "park an increment on an arc, as a proposal",
  async act(args, context) {
    const increment = await (await context.library()).addIncrement(incrementOf(args) as never, context.writer());
    return { text: `Parked increment ${increment.id} on ${increment.fields.arc}.`, next: [{ command: `storytree arc show ${increment.fields.arc}`, why: "see the arc whole" }] };
  },
};

const incrementAdd: Verb = {
  name: "add",
  usage: `arc increment add ${INCREMENT_USAGE} --disposition <landed|failed|withdrawn> [--pr <ref>] [--note <why>]`,
  summary: "record a landing that was never parked: an increment born closed",
  async act(args, context) {
    const increment = await (await context.library()).addIncrement({ ...incrementOf(args), outcome: closeOf(args) } as never, context.writer());
    return { text: `Recorded increment ${increment.id} on ${increment.fields.arc}, closed.`, next: [{ command: `storytree arc show ${increment.fields.arc}`, why: "see its log" }] };
  },
};

const incrementClose: Verb = {
  name: "close",
  usage: "arc increment close <increment> --disposition <landed|failed|withdrawn> [--pr <ref>] [--note <why>]",
  summary: "close an increment with its outcome and end any claim on it",
  async act(args, context) {
    const id = args.word(0, "the increment's id", this.usage);
    const caller = await context.activityContext();
    const outcome = closeOf(args);
    const done = await caller.library.closeIncrement(id, outcome, context.writer());
    if (done === null) throw new Refusal(`no increment "${id}" in this project`);
    const { closed } = await import("@storytree/agent-link");
    await closed(caller, id, outcome.disposition);
    await context.journey?.().then((journey) => journey.incrementClosed(done.fields.outcome?.disposition)).catch(() => {});
    return { text: `Closed increment ${id}: ${done.fields.outcome?.disposition ?? ""}. Any claim on it has ended.`, next: [{ command: `storytree arc show ${done.fields.arc}`, why: "see the arc" }] };
  },
};

const incrementEdit: Verb = {
  name: "edit",
  usage: "arc increment edit <increment> [--title …] [--objective …] [--body …] [--touches a,b] [--held-on q]",
  summary: "change only the named fields",
  async act(args, context): Promise<Answer> {
    const id = args.word(0, "the increment's id", this.usage);
    const edited = await (await context.library()).editIncrement(id, incrementOf(args) as never, context.writer());
    if (edited === null) throw new Refusal(`no increment "${id}" in this project`);
    return { text: `Edited increment ${id}.` };
  },
};

const incrementMove: Verb = {
  name: "move",
  usage: "arc increment move <increment> --to <arc> --reason <why>",
  summary: "re-home an increment on another live arc, keeping its identity and lifecycle",
  async act(args, context) {
    const id = args.word(0, "the increment's id", this.usage);
    const to = args.need("to", this.usage);
    const moved = await (await context.library()).moveIncrement(id, to, args.need("reason", this.usage), context.writer());
    if (moved === null) throw new Refusal(`no increment "${id}" in this project`);
    return { text: `Moved increment ${id} to ${to}.`, next: [{ command: `storytree arc show ${to}`, why: "see the arc whole" }] };
  },
};

const increment: Family = {
  name: "increment",
  summary: "the increments of an arc's work",
  verbs: [incrementNew, incrementAdd, incrementClose, incrementEdit, incrementMove, ...waiting("arc increment", "increment")],
  guesses: { show: "library read <id>", read: "library read <id>", get: "library read <id>", open: "library read <id>" },
  retired: {
    ready: { why: "ADR-0909 retired the increment's ready step, and claiming a proposal starts it.", instead: "workspace <increment> --reason …" },
  },
};

const list: Verb = {
  name: "list",
  usage: "arc list",
  summary: "every live arc and its state",
  async act(_args, context) {
    const library = await context.library();
    const lines: string[] = [];
    for (const view of await library.arcViews()) lines.push(`  ${view.arc.id}  [${stateOf(view)}]  ${view.arc.fields.title}`);
    return {
      text: lines.length === 0 ? "No arcs in this project." : [`${lines.length} arcs:`, ...lines].join("\n"),
      next: [{ command: "storytree arc show <arc>", why: "see one whole" }],
    };
  },
};

const waits: Verb = {
  name: "waits",
  usage: "arc waits",
  summary: "every open increment's waits for you or an outside event, across arcs: yours first, then events by check-back day",
  async act(_args, context) {
    const library = await context.library();
    // Every hold in one ask and every arc in one more, never a read per increment (4.10).
    const [views, holds] = await Promise.all([library.arcViews(), library.holds()]);
    const found = views.flatMap(({ arc, increments }) =>
      increments.flatMap((increment) => (holds.waitsFor?.[increment.id] ?? []).map((wait) => ({ wait, increment, arc }))));
    if (found.length === 0) return { text: "No waits for you or an outside event." };
    // An owner wait has no day, so it sorts before every event; the sort keeps arc order within a day.
    found.sort((one, other) => (one.wait.checkBack ?? "").localeCompare(other.wait.checkBack ?? ""));
    const lines = found.map(({ wait, increment, arc }) => {
      const day = wait.releaser === "event" ? `; check back ${wait.checkBack}${wait.holds ? "" : ", overdue"}` : "";
      return `  - ${wait.releaser === "owner" ? "you  " : "event"}  ${wait.note} — ${increment.id}  ${increment.fields.title}, on ${arc.id}  ${arc.fields.title}${day}`;
    });
    return {
      text: [`${found.length} ${found.length === 1 ? "wait" : "waits"} for you or an outside event:`, ...lines].join("\n"),
      next: [
        { command: "storytree arc show <arc>", why: "see a wait's arc whole" },
        { command: "storytree arc increment unwait <increment> --for owner|event", why: "clear a wait once it is done" },
      ],
    };
  },
};

export const arcs: Family = {
  name: "arc",
  summary: "arcs, and the increments of their work",
  verbs: [show, list, waits, create, edit, parking("park"), parking("unpark"), ...waiting("arc", "arc")],
  families: [increment],
  guesses: { read: "arc show <arc>", get: "arc show <arc>", open: "arc show <arc>" },
};

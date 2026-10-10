/**
 * Capability 5 · Questions (the command line story): raise a question for the owner on an arc, optionally
 * holding increments on it; read one whole; settle it with his answer in his words and the decision
 * that carried it, retire one that was wrong, or list the open ones. Retirement checks the record is
 * a question first; other kinds are directed to `library retire`.
 *
 * Every rule is the library's (its capability 12): the required fields, that settling needs an
 * answer, and that a held increment waits on the owner. Holding an increment is the library's
 * `editIncrement` of its `heldOn`, read from the arc's own view, so only increments on the question's arc are held when it is raised; another is
 * held with `storytree arc increment edit <increment> --held-on <question>`. Retiring one goes through
 * the library's retireQuestion, which takes it off every increment held on it first, so an owner-
 * retired question goes in one step; `library retire` still refuses a held one. `show` reads one
 * question whole, with the open increments held on it. Holding an increment the caller's
 * session holds releases its claims on it, through the agent link's releaseAsked (ADR-0944 D4). Listing the open
 * questions uses list(kind); `--arc` reads one arc's questions, naming a parked arc's as parked with it. `check` reads a question's review
 * lease through the library's checkQuestion, and `renew` re-stamps it through renewQuestion, which
 * refuses a settled question (ADR-0654). `present` marks a question as being put to the owner by the
 * calling session, through the agent link's presentQuestion, which refuses it while another live session
 * is (its 5.36), and `--done` clears the mark; `list` flags each question a live session is presenting.
 */
import type { Presenter } from "@storytree/agent-link";
import type { SchemaRecord } from "@storytree/library";

import { labelOf, Refusal } from "../answer.js";
import type { Context, Family, Verb } from "../door.js";
import { valueOf } from "./library.js";
import { releasedAsking } from "./workspace.js";

const QUESTION_FIELDS = ["arc", "title", "stakes", "statement", "context", "options", "analogy", "diagram", "recommendation"] as const;

const raise: Verb = {
  name: "new",
  usage: "question new --arc <arc> --title <t> --stakes … --statement … --context … --options … [--analogy …] [--diagram …] [--recommendation …] [--hold <increment>]…",
  summary: "raise a question for the owner on an arc, optionally holding increments on it",
  async act(args, context) {
    const unsupported = args.names.filter((name) => ![...QUESTION_FIELDS, "hold"].includes(name));
    if (unsupported.length > 0) {
      throw new Refusal(`unsupported option${unsupported.length === 1 ? "" : "s"}: ${unsupported.map((name) => `--${name}`).join(", ")}\nusage: storytree ${this.usage}`, { code: 2 });
    }
    const fields: Record<string, unknown> = {};
    for (const name of QUESTION_FIELDS) {
      const value = args.text(name);
      if (value !== undefined) fields[name] = valueOf(value);
    }
    const library = await context.library();
    const holds = args.texts("hold");
    const arc = typeof fields.arc === "string" ? fields.arc : undefined;
    const increments = holds.length === 0 || arc === undefined ? [] : ((await library.arcView(arc))?.increments ?? []);
    const held = holds.map((id) => {
      const increment = increments.find((one) => one.id === id);
      if (increment === undefined) {
        throw new Refusal(`${id} is not an increment on ${arc ?? "the question's arc"}: hold it afterwards with \`storytree arc increment edit ${id} --held-on <question>\``);
      }
      return increment;
    });
    const question = await library.raiseQuestion(fields as never, context.writer());
    let released = "";
    for (const increment of held) {
      await library.editIncrement(increment.id, { heldOn: [...(increment.fields.heldOn ?? []), question.id] }, context.writer());
      released += await releasedAsking(context, increment.id);
    }
    return {
      text: `Raised question ${question.id} on ${question.fields.arc}${held.length === 0 ? "" : `, holding ${held.map((one) => one.id).join(", ")}`}.${released}`,
      next: [{ command: `storytree arc show ${question.fields.arc}`, why: "see what waits on him" }],
    };
  },
};

const settle: Verb = {
  name: "settle",
  usage: "question settle <question> --answer <the owner's words|@file> [--decision <decision>]",
  summary: "settle a question with the owner's answer, and the decision that carried it",
  async act(args, context) {
    const id = args.word(0, "the question's id", this.usage);
    const decision = args.text("decision");
    const settled = await (await context.library()).settleQuestion(id, { answer: args.text("answer") as string, ...(decision === undefined ? {} : { decision }) }, context.writer());
    if (settled === null) throw new Refusal(`no question "${id}" in this project`);
    return { text: `Settled question ${id}.`, next: [{ command: `storytree arc show ${settled.fields.arc}`, why: "see what it released" }] };
  },
};

const retire: Verb = {
  name: "retire",
  usage: "question retire <question> --reason <why>",
  summary: "retire a question that was wrong, releasing the increments held on it; other records use library retire",
  async act(args, context) {
    const id = args.word(0, "the question's id", this.usage);
    const reason = args.need("reason", this.usage);
    const library = await context.library();
    const record = await library.get(id);
    if (record === null) throw new Refusal(`no question "${id}" in this project`);
    if (record.type !== "question") {
      throw new Refusal(`${id} is a ${record.type}, not a question`, {
        next: [{ command: `storytree library retire ${id} --reason <why>`, why: "retire another kind of record" }],
      });
    }
    const released = (await library.retireQuestion(id, reason, context.writer())) ?? [];
    return { text: `Retired ${id}.${released.length === 0 ? "" : ` Released ${released.join(", ")}, which no longer ${released.length === 1 ? "holds" : "hold"} on it.`}` };
  },
};

const SHOWN_FIELDS = ["stakes", "statement", "context", "options", "analogy", "diagram", "recommendation", "answer"] as const;

const show: Verb = {
  name: "show",
  usage: "question show <question>",
  summary: "read one question whole: what it asks, its options, its answer, and the open work held on it",
  async act(args, context) {
    const id = args.word(0, "the question's id", this.usage);
    const library = await context.library();
    const record = await library.get(id);
    if (record === null) throw new Refusal(`no question "${id}" in this project`);
    if (record.type !== "question") {
      throw new Refusal(`${id} is a ${record.type}, not a question`, { next: [{ command: `storytree library read ${id}`, why: "read another kind of record" }] });
    }
    const fields = record.fields as Readonly<Record<string, unknown>>;
    const settled = typeof fields.settledAt === "string" ? `, settled ${fields.settledAt}${typeof fields.settledBy === "string" ? ` by ${fields.settledBy}` : ""}` : "";
    const held = Object.entries((await library.holds()).heldOn).flatMap(([increment, on]) => (on.includes(id) ? [increment] : []));
    const lines = [`${labelOf(fields)}  [${id}]`, `On ${String(fields.arc)}, ${String(fields.lifecycle)}${settled}.`];
    for (const name of SHOWN_FIELDS) {
      if (typeof fields[name] === "string") lines.push("", `${name[0]?.toUpperCase()}${name.slice(1)}:`, fields[name]);
    }
    if (held.length > 0) lines.push("", `Holding: ${held.join(", ")}`);
    return { text: lines.join("\n"), next: [{ command: `storytree arc show ${String(fields.arc)}`, why: "see its arc" }] };
  },
};

const present: Verb = {
  name: "present",
  usage: "question present <question> [--done]",
  switches: ["done"],
  summary: "mark a question as being put to the owner by this session, so no other asks him at once; --done when you move on",
  async act(args, context) {
    const id = args.word(0, "the question's id", this.usage);
    const { presentQuestion, stopPresenting } = await import("@storytree/agent-link");
    const caller = await context.claimContext();
    if (args.has("done")) {
      return { text: (await stopPresenting(caller, id)) ? `${id} is no longer being put to the owner by this session.` : `This session was not putting ${id} to the owner.` };
    }
    const answer = await presentQuestion(caller, id);
    if (answer.ok) {
      return {
        text: `${id} is being put to the owner by this session. Settling it with his answer clears that.`,
        next: [{ command: `storytree question present ${id} --done`, why: "if you move on without his answer" }],
      };
    }
    switch (answer.refused) {
      case "presenting":
        throw new Refusal(`${id} is being put to the owner by ${answer.presenter.label} session ${answer.presenter.session} since ${answer.presenter.since}: skip it, and do not ask him again.`);
      case "settled":
        throw new Refusal(`${id} is settled: its answer stands.`, { next: [{ command: `storytree question show ${id}`, why: "read his answer" }] });
      case "unknown-question":
        throw new Refusal(`no question "${id}" in this project`);
    }
  },
};

const list: Verb = {
  name: "list",
  usage: "question list [--arc <arc>]",
  summary: "the open questions across arcs, or on one arc; a parked arc's wait until it is unparked, named by its own listing",
  async act(args, context) {
    const arc = args.text("arc");
    const library = await context.library();
    const open = (await (arc === undefined ? library.list("question") : library.questions(arc))).filter((question) => question.fields.lifecycle === "open");
    // A parked arc's questions are parked with it, off the owner's list (ADR-0835 D2).
    const views = arc === undefined ? await library.arcViews() : [await library.arcView(arc)];
    const parkedArcs = new Set(views.flatMap((view) => (view?.state === "parked" ? [view.arc.id] : [])));
    const waiting = open.filter((question) => !parkedArcs.has(question.fields.arc));
    const parked = open.filter((question) => parkedArcs.has(question.fields.arc));
    // A question another session is putting to the owner right now is flagged, so he is not asked twice (agent link 5.36).
    const presenters = open.some((question) => question.fields.presenting !== undefined) ? await presentersAmong(context, open) : new Map<string, Presenter>();
    const flag = (id: string) => {
      const by = presenters.get(id);
      return by === undefined ? "" : `  (being put to the owner by ${by.label} session ${by.session})`;
    };
    const line = (question: (typeof open)[number]) => `  - ${question.id}  [${question.fields.arc}]  ${labelOf(question.fields)}${flag(question.id)}`;
    const where = arc === undefined ? "across arcs" : `on ${arc}`;
    // Across arcs they stay off the list, but the arcs that hold them are named; one arc's own listing names them.
    const holding = [...new Set(parked.map((question) => question.fields.arc))];
    const aside =
      parked.length === 0
        ? []
        : arc === undefined
          ? [`${parked.length} more ${parked.length === 1 ? "waits" : "wait"} on a parked arc until it is unparked: ${holding.join(", ")} (storytree question list --arc <arc> names them).`]
          : [`${parked.length} parked with the arc until it is unparked:`, ...parked.map(line)];
    if (waiting.length === 0) return { text: [`No question ${where} waits on the owner.`, ...aside].join("\n") };
    return { text: [`${waiting.length} open ${where}:`, ...waiting.map(line), ...aside].join("\n") };
  },
};

/** Of `open`, those a live session is putting to the owner, read through the agent link. */
async function presentersAmong(context: Context, open: readonly SchemaRecord<"question">[]): Promise<ReadonlyMap<string, Presenter>> {
  const { presentersOf } = await import("@storytree/agent-link");
  const { log, project } = await context.activityContext();
  return presentersOf(log, project, open);
}

const check: Verb = {
  name: "check",
  usage: "question check <question>",
  summary: "whether a question's review is still fresh, or its lease has lapsed",
  async act(args, context) {
    const id = args.word(0, "the question's id", this.usage);
    const lease = await (await context.library()).checkQuestion(id);
    if (lease === null) throw new Refusal(`no question "${id}" in this project`);
    const checked = lease.verifiedAt === undefined ? "never checked" : `last checked ${lease.verifiedAt}`;
    if (lease.state === "settled") return { text: `${id} is settled: its answer stands, and its lease no longer applies.` };
    const runs = lease.lapsesAt === undefined ? "" : `, ${lease.state === "fresh" ? "runs out" : "ran out"} ${lease.lapsesAt}`;
    const line = `${id} is ${lease.state}: ${checked}, ${lease.leaseDays}-day lease${runs}.`;
    if (lease.state === "fresh") return { text: line };
    return {
      text: `${line}\nRe-read it: renew it if it still holds as asked, retire it if it no longer does.`,
      next: [{ command: `storytree question show ${id}`, why: "re-read it" }],
    };
  },
};

const renew: Verb = {
  name: "renew",
  usage: "question renew <question>",
  summary: "stamp an open question as checked to still hold, starting its lease again",
  async act(args, context) {
    const id = args.word(0, "the question's id", this.usage);
    const renewed = await (await context.library()).renewQuestion(id, context.writer());
    if (renewed === null) throw new Refusal(`no question "${id}" in this project`);
    return { text: `Renewed ${id}: checked ${renewed.fields.verifiedAt ?? "now"}, for ${renewed.fields.leaseDays ?? 7} days.` };
  },
};

export const questions: Family = {
  name: "question",
  summary: "the owner's questions: raise, show, present, settle, retire, list, check, renew",
  verbs: [raise, show, present, settle, retire, list, check, renew],
  guesses: { read: "question show <id>", get: "question show <id>", open: "question show <id>" },
};

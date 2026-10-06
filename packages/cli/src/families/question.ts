/**
 * Capability 5 · Questions (the command line story): raise a question for the owner on an arc, optionally
 * holding increments on it; settle it with his answer in his words and the decision that carried
 * it, retire one that was wrong, or list the open ones. Retirement checks the record is a
 * question first; other kinds are directed to `library retire`.
 *
 * Every rule is the library's (its capability 12): the required fields, that settling needs an
 * answer, that a held increment waits on the owner, and that a question work is held on cannot be
 * retired. Holding an increment is the library's `editIncrement` of its `heldOn`, read from the
 * arc's own view, so only increments on the question's arc are held when it is raised; another is
 * held with `storytree arc increment edit <increment> --held-on <question>`. Listing the open
 * questions uses list(kind); `--arc` reads one arc's questions. `check` reads a question's review
 * lease through the library's checkQuestion, and `renew` re-stamps it through renewQuestion, which
 * refuses a settled question (ADR-0654).
 */
import { labelOf, Refusal } from "../answer.js";
import type { Family, Verb } from "../door.js";
import { valueOf } from "./library.js";

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
    for (const increment of held) {
      await library.editIncrement(increment.id, { heldOn: [...(increment.fields.heldOn ?? []), question.id] }, context.writer());
    }
    return {
      text: `Raised question ${question.id} on ${question.fields.arc}${held.length === 0 ? "" : `, holding ${held.map((one) => one.id).join(", ")}`}.`,
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
  summary: "retire a question that was wrong; other records use library retire",
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
    await library.retire(id, reason, context.writer());
    return { text: `Retired ${id}.` };
  },
};

const list: Verb = {
  name: "list",
  usage: "question list [--arc <arc>]",
  summary: "the open questions across arcs, or on one arc; a parked arc's wait until it is unparked",
  async act(args, context) {
    const arc = args.text("arc");
    const library = await context.library();
    const open = (await (arc === undefined ? library.list("question") : library.questions(arc))).filter((question) => question.fields.lifecycle === "open");
    // A parked arc's questions are parked with it, off the owner's list (ADR-0835 D2).
    const views = arc === undefined ? await library.arcViews() : [await library.arcView(arc)];
    const parkedArcs = new Set(views.flatMap((view) => (view?.state === "parked" ? [view.arc.id] : [])));
    const waiting = open.filter((question) => !parkedArcs.has(question.fields.arc));
    const parked = open.length - waiting.length;
    const where = arc === undefined ? "across arcs" : `on ${arc}`;
    const aside = parked === 0 ? [] : [`${parked} more ${parked === 1 ? "waits" : "wait"} on a parked arc until it is unparked.`];
    if (waiting.length === 0) return { text: [`No question ${where} waits on the owner.`, ...aside].join("\n") };
    return { text: [`${waiting.length} open ${where}:`, ...waiting.map((question) => `  - ${question.id}  [${question.fields.arc}]  ${labelOf(question.fields)}`), ...aside].join("\n") };
  },
};

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
      next: [{ command: `storytree library read ${id}`, why: "re-read it" }],
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
  summary: "the owner's questions: raise, settle, retire, list, check, renew",
  verbs: [raise, settle, retire, list, check, renew],
  guesses: { show: "library read <id>", read: "library read <id>", get: "library read <id>", open: "library read <id>" },
};

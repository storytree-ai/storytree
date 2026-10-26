/**
 * Capability 3 · Arc surface. The `question` verbs, declared here (ADR-0969 D2) and mounted by the command line as its
 * `question` family (ADR-1033): raise a question for the owner on an arc, optionally holding increments on it; read one
 * whole; settle it with his answer in his words and the decision that carried it, retire one that was wrong, or list the
 * open ones, or move an open one to another arc. Retirement checks the record is a question first; other kinds are directed to `library retire`. None is a
 * tool: the MCP server's own raise_question, present_question, settle_question, retire_question and move_question do these jobs.
 *
 * Every rule is the library's (its capability 12): the required fields, that settling needs an answer, and that a held
 * increment waits on the owner. Holding an increment is the library's `editIncrement` of its `heldOn`, read from the
 * arc's own view, so only increments on the question's arc are held when it is raised; another is held with
 * `storytree arc increment edit <increment> --held-on <question>`. Retiring one goes through the library's
 * retireQuestion, which takes it off every increment held on it first. `show` reads one question whole, with the open
 * increments held on it. Holding an increment the caller's session holds releases its claims on it, through Session
 * management's releaseAsked (ADR-0944 D4). `--arc` lists one arc's questions, naming a parked arc's as parked with it.
 * `check` reads a question's review lease, and `renew` re-stamps it, which refuses a settled question (ADR-0654).
 * `present` marks a question as being put to the owner by the calling session, through Session management's
 * presentQuestion, which refuses it while another live session is (its 5.36), and `--done` clears the mark; `list`
 * flags each question a live session is presenting.
 */
import { verb, VerbRefusal } from "@storytree/library/verbs";
import type { SchemaRecord } from "@storytree/library";

import { labelOf, releasedAsking, valueOf, type ArcVerbContext } from "./context.js";

const NO_TOOL = "the MCP server's own question tools do this";

const raise = verb({
  command: {
    family: "question",
    name: "new",
    summary: "raise a question for the owner on an arc, optionally holding increments on it",
    usage: "question new --arc <arc> --title <t> --stakes … --statement … --context … --options … [--analogy …] [--diagram …] [--recommendation …] [--hold <increment>]…",
  },
  tool: { absent: NO_TOOL },
  inputs: {
    arc: { kind: "text", optional: true, describe: "the arc it is on" },
    title: { kind: "text", optional: true, describe: "its title" },
    stakes: { kind: "text", optional: true, describe: "what rides on it" },
    statement: { kind: "text", optional: true, describe: "the question" },
    context: { kind: "text", optional: true, describe: "what he needs to answer it cold" },
    options: { kind: "text", optional: true, describe: "the options, each with both sides" },
    analogy: { kind: "text", optional: true, describe: "an analogy, saying where it breaks" },
    diagram: { kind: "text", optional: true, describe: "a diagram" },
    recommendation: { kind: "text", optional: true, describe: "a recommendation, marked non-binding" },
    hold: { kind: "text", many: true, optional: true, describe: "an increment on its arc to hold on it" },
  },
  writes: true,
  async act({ hold: holds, ...given }, context: ArcVerbContext) {
    const fields: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(given)) if (value !== undefined) fields[name] = valueOf(value);
    const { library } = context;
    const arc = typeof fields.arc === "string" ? fields.arc : undefined;
    const increments = holds.length === 0 || arc === undefined ? [] : ((await library.arcView(arc))?.increments ?? []);
    const held = holds.map((id) => {
      const increment = increments.find((one) => one.id === id);
      if (increment === undefined) {
        throw new VerbRefusal(`${id} is not an increment on ${arc ?? "the question's arc"}: hold it afterwards with \`storytree arc increment edit ${id} --held-on <question>\``);
      }
      return increment;
    });
    const question = await library.raiseQuestion(fields as never, context.writer);
    let released = "";
    for (const increment of held) {
      await library.editIncrement(increment.id, { heldOn: [...(increment.fields.heldOn ?? []), question.id] }, context.writer);
      released += await releasedAsking(context, increment.id);
    }
    return {
      text: `Raised question ${question.id} on ${question.fields.arc}${held.length === 0 ? "" : `, holding ${held.map((one) => one.id).join(", ")}`}.${released}`,
      next: [{ command: `arc show ${question.fields.arc}`, why: "see what waits on him" }],
    };
  },
});

const settle = verb({
  command: { family: "question", name: "settle", summary: "settle a question with the owner's answer, and the decision that carried it", usage: "question settle <question> --answer <the owner's words|@file> [--decision <decision>]" },
  tool: { absent: NO_TOOL },
  inputs: {
    question: { kind: "text", word: 0, describe: "the question's id" },
    answer: { kind: "text", optional: true, describe: "the owner's answer, in his words" },
    decision: { kind: "text", optional: true, describe: "the decision that carried it" },
  },
  writes: true,
  async act({ question: id, answer, decision }, context: ArcVerbContext) {
    const settled = await context.library.settleQuestion(id, { answer: answer as string, ...(decision === undefined ? {} : { decision }) }, context.writer);
    if (settled === null) throw new VerbRefusal(`no question "${id}" in this project`);
    return { text: `Settled question ${id}.`, next: [{ command: `arc show ${settled.fields.arc}`, why: "see what it released" }] };
  },
});

const retire = verb({
  command: { family: "question", name: "retire", summary: "retire a question that was wrong, releasing the increments held on it; other records use library retire" },
  tool: { absent: NO_TOOL },
  inputs: {
    question: { kind: "text", word: 0, describe: "the question's id" },
    reason: { kind: "text", describe: "why" },
  },
  writes: true,
  async act({ question: id, reason }, context: ArcVerbContext) {
    const { library } = context;
    const record = await library.get(id);
    if (record === null) throw new VerbRefusal(`no question "${id}" in this project`);
    if (record.type !== "question") {
      throw new VerbRefusal(`${id} is a ${record.type}, not a question`, { next: [{ command: `library retire ${id} --reason <why>`, why: "retire another kind of record" }] });
    }
    const released = (await library.retireQuestion(id, reason, context.writer)) ?? [];
    return { text: `Retired ${id}.${released.length === 0 ? "" : ` Released ${released.join(", ")}, which no longer ${released.length === 1 ? "holds" : "hold"} on it.`}` };
  },
});

const SHOWN_FIELDS = ["stakes", "statement", "context", "options", "analogy", "diagram", "recommendation", "answer"] as const;

const show = verb({
  command: { family: "question", name: "show", summary: "read one question whole: what it asks, its options, its answer, and the open work held on it" },
  tool: { absent: "the MCP server's own open tool reads a question whole" },
  inputs: { question: { kind: "text", word: 0, describe: "the question's id" } },
  async act({ question: id }, { library }: ArcVerbContext) {
    const record = await library.get(id);
    if (record === null) throw new VerbRefusal(`no question "${id}" in this project`);
    if (record.type !== "question") {
      throw new VerbRefusal(`${id} is a ${record.type}, not a question`, { next: [{ command: `library read ${id}`, why: "read another kind of record" }] });
    }
    const fields = record.fields as Readonly<Record<string, unknown>>;
    const settled = typeof fields.settledAt === "string" ? `, settled ${fields.settledAt}${typeof fields.settledBy === "string" ? ` by ${fields.settledBy}` : ""}` : "";
    const held = Object.entries((await library.holds()).heldOn).flatMap(([increment, on]) => (on.includes(id) ? [increment] : []));
    const lines = [`${labelOf(fields)}  [${id}]`, `On ${String(fields.arc)}, ${String(fields.lifecycle)}${settled}.`];
    for (const name of SHOWN_FIELDS) {
      if (typeof fields[name] === "string") lines.push("", `${name[0]?.toUpperCase()}${name.slice(1)}:`, fields[name]);
    }
    if (held.length > 0) lines.push("", `Holding: ${held.join(", ")}`);
    return { text: lines.join("\n"), next: [{ command: `arc show ${String(fields.arc)}`, why: "see its arc" }] };
  },
});

const present = verb({
  command: { family: "question", name: "present", summary: "mark a question as being put to the owner by this session, so no other asks him at once; --done when you move on" },
  tool: { absent: NO_TOOL },
  inputs: {
    question: { kind: "text", word: 0, describe: "the question's id" },
    done: { kind: "switch", describe: "this session has moved on without his answer" },
  },
  async act({ question: id, done }, context: ArcVerbContext) {
    // A person's own shell has no agent session to present it (the door names a person's session `person:<name>`).
    if (context.session.startsWith("person:")) throw new VerbRefusal("Run workspace from the agent's shell: a claim belongs to the agent session that will work there.");
    const { presentQuestion, stopPresenting } = await import("@storytree/session-management");
    if (done) {
      return { text: (await stopPresenting(context, id)) ? `${id} is no longer being put to the owner by this session.` : `This session was not putting ${id} to the owner.` };
    }
    const answer = await presentQuestion(context, id);
    if (answer.ok) {
      return {
        text: `${id} is being put to the owner by this session. Settling it with his answer clears that.`,
        next: [{ command: `question present ${id} --done`, why: "if you move on without his answer" }],
      };
    }
    switch (answer.refused) {
      case "presenting":
        throw new VerbRefusal(`${id} is being put to the owner by ${answer.presenter.label} session ${answer.presenter.session} since ${answer.presenter.since}: skip it, and do not ask him again.`);
      case "settled":
        throw new VerbRefusal(`${id} is settled: its answer stands.`, { next: [{ command: `question show ${id}`, why: "read his answer" }] });
      case "unknown-question":
        throw new VerbRefusal(`no question "${id}" in this project`);
    }
  },
});

/** The live session putting a question to the owner, as this listing names it: its own copy of what it reads (ADR-1017 D2). */
type Presenter = { readonly session: string; readonly label: string };

/** Of `open`, those a live session is putting to the owner, read through Session management. */
async function presentersAmong({ log, project }: ArcVerbContext, open: readonly SchemaRecord<"question">[]): Promise<ReadonlyMap<string, Presenter>> {
  const { presentersOf } = await import("@storytree/session-management");
  return presentersOf(log, project, open);
}

const list = verb({
  command: { family: "question", name: "list", summary: "the open questions across arcs, or on one arc; a parked arc's wait until it is unparked, named by its own listing", usage: "question list [--arc <arc>]" },
  tool: { absent: "the MCP server's own show_plan names the open questions" },
  inputs: { arc: { kind: "text", optional: true, describe: "one arc" } },
  async act({ arc }, context: ArcVerbContext) {
    const { library } = context;
    const open = (await (arc === undefined ? library.list("question") : library.questions(arc))).filter((question) => question.fields.lifecycle === "open");
    // A parked arc's questions are parked with it, off the owner's list (ADR-0835 D2).
    const views = arc === undefined ? await library.arcViews() : [await library.arcView(arc)];
    const parkedArcs = new Set(views.flatMap((view) => (view?.state === "parked" ? [view.arc.id] : [])));
    const waiting = open.filter((question) => !parkedArcs.has(question.fields.arc));
    const parked = open.filter((question) => parkedArcs.has(question.fields.arc));
    // A question another session is putting to the owner right now is flagged, so he is not asked twice (Session management 5.36).
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
});

const check = verb({
  command: { family: "question", name: "check", summary: "whether a question's review is still fresh, or its lease has lapsed" },
  tool: { absent: NO_TOOL },
  inputs: { question: { kind: "text", word: 0, describe: "the question's id" } },
  async act({ question: id }, { library }: ArcVerbContext) {
    const lease = await library.checkQuestion(id);
    if (lease === null) throw new VerbRefusal(`no question "${id}" in this project`);
    const checked = lease.verifiedAt === undefined ? "never checked" : `last checked ${lease.verifiedAt}`;
    if (lease.state === "settled") return { text: `${id} is settled: its answer stands, and its lease no longer applies.` };
    const runs = lease.lapsesAt === undefined ? "" : `, ${lease.state === "fresh" ? "runs out" : "ran out"} ${lease.lapsesAt}`;
    const line = `${id} is ${lease.state}: ${checked}, ${lease.leaseDays}-day lease${runs}.`;
    if (lease.state === "fresh") return { text: line };
    return {
      text: `${line}\nRe-read it: renew it if it still holds as asked, retire it if it no longer does.`,
      next: [{ command: `question show ${id}`, why: "re-read it" }],
    };
  },
});

const renew = verb({
  command: { family: "question", name: "renew", summary: "stamp an open question as checked to still hold, starting its lease again" },
  tool: { absent: NO_TOOL },
  inputs: { question: { kind: "text", word: 0, describe: "the question's id" } },
  writes: true,
  async act({ question: id }, context: ArcVerbContext) {
    const renewed = await context.library.renewQuestion(id, context.writer);
    if (renewed === null) throw new VerbRefusal(`no question "${id}" in this project`);
    return { text: `Renewed ${id}: checked ${renewed.fields.verifiedAt ?? "now"}, for ${renewed.fields.leaseDays ?? 7} days.` };
  },
});

const move = verb({
  command: { family: "question", name: "move", summary: "re-home an open question on another arc, keeping its id, wording and the increments held on it", usage: "question move <question> --to <arc> --reason <text>" },
  tool: { absent: "the MCP server's own move_question moves a question" },
  inputs: {
    question: { kind: "text", word: 0, describe: "the question's id" },
    to: { kind: "text", describe: "the arc" },
    reason: { kind: "text", describe: "why" },
  },
  writes: true,
  async act({ question: id, to, reason }, context: ArcVerbContext) {
    const moved = await context.library.moveQuestion(id, to, reason, context.writer);
    if (moved === null) throw new VerbRefusal(`no question "${id}" in this project`);
    return { text: `Moved question ${id} to ${to}.`, next: [{ command: `question list --arc ${to}`, why: "see the arc's questions" }] };
  },
});

/** The question verbs, as the command line's `question` family lists them. */
export const QUESTION_VERBS = [raise, show, present, settle, retire, move, list, check, renew];

/** Words agents try for reading one question. */
export const QUESTION_GUESSES: Readonly<Record<string, string>> = { read: "question show <id>", get: "question show <id>", open: "question show <id>" };

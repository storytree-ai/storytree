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
 * A question links the evidence it cites (contracts 3.32 and 3.33): `new --links` names it, beside the records its words
 * name; `show` names each by title on its Evidence line and `list` counts them; `link-named` links the records named in
 * a question's words that it does not link yet, for the backfill and the prep pass.
 * For the assistant pass (ADR-1231 D3, contracts 3.22 and 3.23): `predict` records its would-be answer, which only
 * `prediction` reads while the question is open (show and list never carry it); `prep` marks it prepped, which `list`
 * flags; `score` scores a settled one; `deviation` counts the scores per confidence band over a window.
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
    usage: "question new --arc <arc> --title <t> --stakes … --statement … --context … --options … [--analogy …] [--diagram …] [--recommendation …] [--links a,b] [--hold <increment>]…",
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
    links: { kind: "text", optional: true, describe: "the records it cites as evidence, comma-separated; those its words name are linked too" },
    hold: { kind: "text", many: true, optional: true, describe: "an increment on its arc to hold on it" },
  },
  writes: true,
  async act({ hold: holds, links, ...given }, context: ArcVerbContext) {
    const fields: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(given)) if (value !== undefined) fields[name] = valueOf(value);
    if (links !== undefined) fields.links = links.split(",").map((id) => id.trim()).filter((id) => id !== "");
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
    const evidence = await evidenceLine(library, record as SchemaRecord<"question">);
    if (evidence !== undefined) lines.push("", evidence);
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
    // A prepped question says the pass's stance; one reworded since its prep reads unprepared (Owner questions 12.15).
    const prepFlag = ({ fields: { prep } }: (typeof open)[number]) =>
      prep === undefined ? "" : prep.editedAt !== undefined ? "  (unprepared: edited since its prep)" : `  (prepped: ${prep.stance === "retire" ? "proposes retire" : prep.stance})`;
    // Its evidence counted right after its title (3.32), where the voice door's catch_up reads it as the title's.
    const linked = ({ fields: { links } }: (typeof open)[number]) => (links === undefined || links.length === 0 ? "" : `  (${links.length} linked)`);
    const line = (question: (typeof open)[number]) => `  - ${question.id}  [${question.fields.arc}]  ${labelOf(question.fields)}${linked(question)}${prepFlag(question)}${flag(question.id)}`;
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

/** A library step's refusal of a question's state (settled, open, already scored) as the verb's own. */
function refused(error: unknown): never {
  throw error instanceof RangeError ? new VerbRefusal(error.message) : error;
}

/** One of `allowed` as `name` was given, or a refusal naming them. */
function oneOf<T extends string>(given: string, allowed: readonly T[], name: string): T {
  if ((allowed as readonly string[]).includes(given)) return given as T;
  throw new VerbRefusal(`${name} is ${allowed.slice(0, -1).join(", ")} or ${allowed.at(-1)}, not "${given}"`);
}

const CONFIDENCES = ["high", "medium", "low"] as const;
const VERDICTS = ["match", "match-with-changes", "different", "rejected"] as const;
const STANCES = ["agrees", "differs", "retire"] as const;

/** A would-be answer's pick in words: an option by its number, retire or defer. */
const pickWords = (pick: number | string): string => (typeof pick === "number" ? `option ${pick}` : pick);

const predict = verb({
  command: {
    family: "question",
    name: "predict",
    summary: "record the assistant pass's would-be answer to an open question, sealed from every read of it the owner hears; a later one replaces it",
    usage: "question predict <question> --pick <option number|retire|defer> --confidence high|medium|low --why <one line>",
  },
  tool: { absent: NO_TOOL },
  inputs: {
    question: { kind: "text", word: 0, describe: "the question's id" },
    pick: { kind: "text", describe: "the option it would pick, by number, or retire or defer" },
    confidence: { kind: "text", describe: "high, medium or low" },
    why: { kind: "text", describe: "why, in one line" },
  },
  writes: true,
  async act({ question: id, pick: given, confidence, why }, context: ArcVerbContext) {
    const word = given.trim();
    const pick: number | "retire" | "defer" | undefined = /^[1-9]\d*$/.test(word) ? Number(word) : word === "retire" ? "retire" : word === "defer" ? "defer" : undefined;
    if (pick === undefined) throw new VerbRefusal(`--pick is an option's number, retire or defer, not "${given}"`);
    const answer = { pick, confidence: oneOf(confidence, CONFIDENCES, "--confidence"), why };
    const recorded = await context.library.predictQuestion(id, answer, context.writer).catch(refused);
    if (recorded === null) throw new VerbRefusal(`no question "${id}" in this project`);
    return {
      text: `Recorded a would-be answer for ${id}: ${pickWords(recorded.fields.pick)}, ${recorded.fields.confidence} confidence, at ${recorded.fields.at}. No read of the question shows it while it is open.`,
      next: [{ command: `question prep ${id} --stance agrees|differs|retire`, why: "mark it prepped" }],
    };
  },
});

const prediction = verb({
  command: { family: "question", name: "prediction", summary: "read a question's would-be answer: the one read that shows it while the question is open" },
  tool: { absent: NO_TOOL },
  inputs: { question: { kind: "text", word: 0, describe: "the question's id" } },
  async act({ question: id }, { library }: ArcVerbContext) {
    const record = await library.get(id);
    if (record?.type !== "question") throw new VerbRefusal(`no question "${id}" in this project`);
    const recorded = await library.questionPrediction(id);
    if (recorded === null) return { text: `${id} has no would-be answer.` };
    const { pick, confidence, why, at } = recorded.fields;
    return { text: `${id}'s would-be answer, recorded ${at}: ${pickWords(pick)}, ${confidence} confidence: ${why}` };
  },
});

const score = verb({
  command: {
    family: "question",
    name: "score",
    summary: "score a settled question once: its would-be answer and its raiser's recommendation against the owner's answer",
    usage: "question score <question> [--prediction <verdict>] [--recommendation <verdict>] [--by <who>], each verdict match, match-with-changes, different or rejected",
  },
  tool: { absent: NO_TOOL },
  inputs: {
    question: { kind: "text", word: 0, describe: "the question's id" },
    prediction: { kind: "text", optional: true, describe: "how its would-be answer compares with his" },
    recommendation: { kind: "text", optional: true, describe: "how its raiser's recommendation compares with his" },
    by: { kind: "text", optional: true, describe: "who scored it, the caller unless given" },
  },
  writes: true,
  async act({ question: id, prediction: forPrediction, recommendation: forRecommendation, by }, context: ArcVerbContext) {
    const given = {
      ...(forPrediction === undefined ? {} : { prediction: oneOf(forPrediction, VERDICTS, "--prediction") }),
      ...(forRecommendation === undefined ? {} : { recommendation: oneOf(forRecommendation, VERDICTS, "--recommendation") }),
      by: by ?? context.writer?.actor ?? context.session,
    };
    const scored = await context.library.scoreQuestion(id, given, context.writer).catch(refused);
    if (scored === null) throw new VerbRefusal(`no question "${id}" in this project`);
    const sides = [
      ...(given.prediction === undefined ? [] : [`would-be answer ${given.prediction}`]),
      ...(given.recommendation === undefined ? [] : [`raiser's recommendation ${given.recommendation}`]),
    ];
    return { text: `Scored ${id} by ${given.by}: ${sides.join(", ")}.`, next: [{ command: "question deviation", why: "see the match rate per confidence band" }] };
  },
});

const prep = verb({
  command: {
    family: "question",
    name: "prep",
    summary: "mark an open question prepped, with the pass's stance on the raiser's recommendation; editing its wording afterwards makes it unprepared",
    usage: "question prep <question> --stance agrees|differs|retire [--reason <why>]",
  },
  tool: { absent: NO_TOOL },
  inputs: {
    question: { kind: "text", word: 0, describe: "the question's id" },
    stance: { kind: "text", describe: "agrees, differs or retire" },
    reason: { kind: "text", optional: true, describe: "why, needed when it differs or proposes retire" },
  },
  writes: true,
  async act({ question: id, stance, reason }, context: ArcVerbContext) {
    const mark = { stance: oneOf(stance, STANCES, "--stance"), ...(reason === undefined ? {} : { reason }) };
    if (mark.stance !== "agrees" && reason === undefined) throw new VerbRefusal(`a prep mark that ${mark.stance === "differs" ? "differs" : "proposes retire"} needs --reason`);
    const prepped = await context.library.prepQuestion(id, mark, context.writer).catch(refused);
    if (prepped === null) throw new VerbRefusal(`no question "${id}" in this project`);
    return { text: `Prepped ${id}: ${STANCE_WORDS[mark.stance]}${reason === undefined ? "" : `, because ${reason}`}.` };
  },
});

/** A prep mark's stance in words. */
const STANCE_WORDS: Readonly<Record<(typeof STANCES)[number], string>> = { agrees: "agrees with the raiser", differs: "differs from the raiser", retire: "proposes retire" };

/** A band's verdicts, each counted. */
const counted = (tally: Readonly<Record<string, number>>): string => VERDICTS.map((verdict) => `${tally[verdict] ?? 0} ${verdict.replaceAll("-", " ")}`).join(", ");

const deviation = verb({
  command: {
    family: "question",
    name: "deviation",
    summary: "for questions settled in a window, how the would-be answers scored per confidence band, beside the raisers' recommendations",
    usage: "question deviation [--days <n>, 14 unless given]",
  },
  tool: { absent: NO_TOOL },
  inputs: { days: { kind: "text", optional: true, describe: "how many days back the window reaches, 14 unless given" } },
  async act({ days: given }, { library }: ArcVerbContext) {
    if (given !== undefined && !/^[1-9]\d*$/.test(given.trim())) throw new VerbRefusal(`--days is a whole number of days, not "${given}"`);
    const days = given === undefined ? 14 : Number(given);
    const window = `the last ${days} day${days === 1 ? "" : "s"}`;
    const report = await library.questionDeviation(new Date(Date.now() - days * 86_400_000));
    if (report.bands.length === 0) {
      return { text: `No question settled in ${window} has been scored.${report.settled === 0 ? "" : ` ${report.settled} settled unscored.`}` };
    }
    const lines = [`Questions settled in ${window}: ${report.settled}, ${report.unscored} of them unscored.`];
    for (const band of report.bands) {
      const name = band.band === "none" ? "no would-be answer" : band.band;
      const predicted = band.prediction === undefined ? "" : `would-be answer ${counted(band.prediction)}; `;
      lines.push(`  ${name} (${band.questions}): ${predicted}raiser's recommendation ${counted(band.recommendation)}`);
    }
    return { text: lines.join("\n") };
  },
});

const linkNamed = verb({
  command: {
    family: "question",
    name: "link-named",
    summary: "link the live records a question's words name that it does not link yet, open or settled: the backfill, and the prep pass's catch",
    usage: "question link-named <question>… | --all",
  },
  tool: { absent: NO_TOOL },
  inputs: {
    questions: { kind: "text", word: 0, many: true, optional: true, describe: "the questions' ids" },
    all: { kind: "switch", describe: "every question, open or settled" },
  },
  writes: true,
  async act({ questions: given = [], all }, context: ArcVerbContext) {
    const { library } = context;
    if (given.length === 0 && all !== true) throw new VerbRefusal("name the questions to link, or give --all", { misuse: true });
    const ids = all === true ? (await library.list("question")).map(({ id }) => id) : given;
    let added = 0;
    for (const id of ids) {
      const record = await library.get(id);
      const before = record?.type === "question" ? ((record.fields as { links?: readonly string[] }).links?.length ?? 0) : 0;
      const linked = await library.linkNamedEvidence(id, context.writer);
      if (linked === null) throw new VerbRefusal(`no question "${id}" in this project`);
      added += (linked.fields.links?.length ?? 0) - before;
    }
    const records = `${added} ${added === 1 ? "record" : "records"}`;
    return { text: ids.length === 1 && all !== true ? `Linked ${records} ${ids[0]} names.` : `Linked ${records} across ${ids.length} questions.` };
  },
});

/** A question's Evidence line (3.32): each record it links, by title, or undefined when it links none. */
async function evidenceLine(library: ArcVerbContext["library"], question: SchemaRecord<"question">): Promise<string | undefined> {
  const links = question.fields.links ?? [];
  if (links.length === 0) return undefined;
  const named = await Promise.all(links.map(async (id) => {
    const record = await library.get(id);
    return record === null ? `${id} (no longer live)` : `${labelOf(record.fields as Readonly<Record<string, unknown>>)} [${id}]`;
  }));
  return `Evidence: ${named.join(", ")}`;
}

/** The question verbs, as the command line's `question` family lists them. */
export const QUESTION_VERBS = [raise, show, present, settle, retire, move, list, check, renew, predict, prediction, score, prep, deviation, linkNamed];

/** Words agents try for reading one question. */
export const QUESTION_GUESSES: Readonly<Record<string, string>> = { read: "question show <id>", get: "question show <id>", open: "question show <id>" };

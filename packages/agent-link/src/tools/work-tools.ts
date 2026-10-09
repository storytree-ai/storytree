/**
 * Capability 6 · Agent tools (the MCP server). The work tools (ADR-0643 D1, 6): park, ready, move and close increments, add to what one remedies, park and unpark arcs, set and
 * clear waits, raise, correct, settle and retire the owner's questions, and record friction and re-steers. Each is a thin wrapper over the library's own
 * functions, or this story's capture functions over them, so no library rule is kept here twice.
 * Starting an increment is claiming it (claim-tools.ts), so a start is refused as a claim is. Asking the owner about work the
 * session holds, by a question held on it or a wait for the owner, releases its claims on it (releaseAsked, ADR-0944 D4).
 *
 * There is no hand close or re-open of an arc (ADR-0640 R1, 10-b): an arc reads closed when its
 * last increment closes, which close_increment says, and re-opens when work is parked on it, which
 * park_increment says.
 */
import type { Library } from "@storytree/library";
import { z } from "zod";

import { recordFriction, recordResteer, reinforceFriction } from "../capture/index.js";
import { closed, currentBranch, increments, releaseAsked } from "../claims/index.js";
import { lineOf, type Answer, type Call, type Define } from "./server.js";
import { quoted } from "./text.js";

const id = (what: string) => z.string().min(1).describe(`The id of the ${what}, as the plan shows it`);
const disposition = z.enum(["landed", "failed", "withdrawn"]).describe("What the close meant: landed, failed, or withdrawn");
const pr = z.string().min(1).optional().describe("Its pull request, such as #12");
const note = z.string().min(1).optional().describe("Why it closed: needed when there is no pull request");
/** Who releases a wait for something outside the plan, in words. */
const releasedBy = (releaser: "owner" | "event"): string => (releaser === "owner" ? "the owner" : "an outside event");

export function registerWorkTools(define: Define): void {
  define(
    "park_increment",
    "Park an increment of work on an arc, as a proposal: what it is, its objective, and its breakdown in the body. Leave its capabilities empty unless you know them: the session that claims it fills them in as it plans (ADR-0949 D2); cite its stories, notes or decisions as links. To record work that landed without ever being parked, give its outcome, and it is born closed. Parking work on a closed arc re-opens it.",
    z.object({
      arc: id("arc"),
      title: z.string().min(1).describe("What it is called: a short name"),
      objective: z.string().min(1).describe("What it delivers, in a sentence"),
      body: z.string().min(1).describe("The increment itself: how the work breaks down"),
      capabilities: z.array(z.string().min(1)).optional().describe("The ids of the capabilities it changes, and nothing else: its lock list"),
      links: z.array(z.string().min(1)).optional().describe("The ids of anything else it cites: its stories, notes or decisions"),
      outcome: z.object({ disposition, pr, note }).optional().describe("Only for work that already landed without being parked: how it closed"),
    }),
    async ({ arc, title, objective, body, capabilities, links, outcome }, { library, writer }) => {
      const before = (await library.arcView(arc))?.state;
      const increment = await library.addIncrement({
        arc,
        title,
        objective,
        body,
        ...(capabilities === undefined ? {} : { capabilities }),
        ...(links === undefined ? {} : { links }),
        ...(outcome === undefined ? {} : { outcome: defined(outcome) }),
      }, writer);
      const said = outcome === undefined ? `Parked ${quoted(title)} (${increment.id}) as a proposal. Claim it to start it.` : `Recorded ${quoted(title)} (${increment.id}), ${outcome.disposition}.`;
      const saved = { text: said, data: { id: increment.id } };
      return afterWrite(saved, async () => {
        const reopened = before === "closed" && (await library.arcView(arc))?.state === "active" ? ` Its arc ${await arcName(library, arc)} re-opens.` : "";
        return { ...saved, text: `${said}${reopened}` };
      });
    },
  );

  define(
    "close_increment",
    "Close an increment with its outcome: landed, failed or withdrawn, with its pull request, or a note when there is none. Any claim on it ends.",
    z.object({ increment: id("increment"), disposition, pr, note }),
    async ({ increment, disposition: meant, pr: pull, note: why }, call) => {
      const done = await call.library.closeIncrement(increment, defined({ disposition: meant, pr: pull, note: why }), call.writer);
      if (done === null) return noIncrement(increment);
      const saved = { text: `Closed ${quoted(done.fields.title)} (${increment}), ${meant}.`, data: { id: increment, disposition: meant } };
      await closed(claimContext(call), increment, meant);
      try { call.journey?.incrementClosed?.(done.fields.outcome?.disposition); } catch { /* Observation cannot fail a completed close. */ }
      return afterWrite(saved, async () => {
        const view = await call.library.arcView(done.fields.arc);
        const arc = view?.state === "closed" ? ` Its arc ${await arcName(call.library, done.fields.arc)} now reads closed: that was its last open increment.` : "";
        return { ...saved, text: `${saved.text}${arc}` };
      });
    },
  );

  define(
    "move_increment",
    "Move an increment to another arc, with the reason: it keeps its id, lifecycle, waits and claims, and its history records the move. Completed history may move into a closed arc; open work may not.",
    z.object({ increment: id("increment"), to: id("arc it moves to"), reason: z.string().min(1).describe("Why it moves, in a line") }),
    async ({ increment, to, reason }, { library, writer }) => {
      const moved = await library.moveIncrement(increment, to, reason, writer);
      if (moved === null) return noIncrement(increment);
      const said = `Moved ${quoted(moved.fields.title)} (${increment}) to arc`;
      const saved = { text: `${said} ${to}.`, data: { id: increment } };
      return afterWrite(saved, async () => ({ ...saved, text: `${said} ${await arcName(library, to)}.` }));
    },
  );

  define(
    "add_remedies",
    "Add friction to what an already-parked increment remedies, keeping those it had: the increment is then the fix the friction can be routed to (route: tool). Each friction must be live.",
    z.object({ increment: id("increment"), frictions: z.array(z.string().min(1)).min(1).describe("The ids of the friction it remedies") }),
    async ({ increment, frictions }, { library, writer }) => {
      const had = (await library.get(increment))?.fields as { remedies?: string[] } | undefined;
      const edited = await library.editIncrement(increment, { remedies: [...new Set([...(had?.remedies ?? []), ...frictions])] }, writer);
      if (edited === null) return noIncrement(increment);
      return { text: `${quoted(edited.fields.title)} (${increment}) now remedies ${edited.fields.remedies?.join(", ")}.`, data: { id: increment } };
    },
  );

  define(
    "park_arc",
    "Park an arc, so that it reads parked whatever its work, or unpark it (parked: false). Give until (a day) and it wakes by itself at UTC midnight of that day.",
    z.object({
      arc: id("arc"),
      parked: z.boolean().describe("true to park it, false to unpark it"),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Only when parking: the day it wakes, YYYY-MM-DD (UTC midnight)"),
    }),
    async ({ arc, parked, until }, { library, writer }) => {
      const done = parked ? await library.parkArc(arc, { ...writer, ...(until === undefined ? {} : { until }) }) : await library.unparkArc(arc, writer);
      if (done === null) return { text: `There is no arc ${arc} in this project's plan.`, refused: true };
      const day = until === undefined ? "" : ` until ${until}: it wakes by itself at UTC midnight`;
      return { text: parked ? `Parked arc ${quoted(done.fields.title)} (${arc})${day}.` : `Unparked arc ${quoted(done.fields.title)} (${arc}).`, data: { id: arc } };
    },
  );

  define(
    "set_wait",
    "Make an increment wait on another increment, on any arc, or an arc on another arc, with the reason (`on`, `reason`). Or make an increment wait for something outside the plan, with a note (`for`, `note`): the owner, for an action only they can take that is not a decision (a decision is a question), or an outside event, with the day to check back, from which it reads ready again. Waiting work cannot be claimed or started until the wait releases; a wait for the owner releases your claims on the increment and the capabilities you took for it.",
    z.object({
      waiter: z.string().min(1).describe("The id of the increment or arc that waits"),
      on: z.string().min(1).optional().describe("The id of the increment or arc it waits on; or give `for` instead"),
      reason: z.string().min(1).optional().describe("With `on`: why it waits, in a line"),
      for: z.enum(["owner", "event"]).optional().describe("Instead of `on`, for an increment: what outside the plan it waits for: the owner, or an outside event"),
      note: z.string().min(1).optional().describe("With `for`: what the owner must do, or what must happen, in a line"),
      check_back: z.string().min(1).optional().describe("With `for: event`, required: the day to check back (YYYY-MM-DD), from which it reads ready again"),
    }),
    async ({ waiter, on, reason, for: releaser, note, check_back }, call) => {
      const { library, writer } = call;
      if (releaser !== undefined && on === undefined) {
        if (note === undefined) return { text: "A wait for the owner or an outside event needs a `note` saying what.", refused: true };
        const done = await library.addWaitFor(waiter, { releaser, note, ...(check_back === undefined ? {} : { checkBack: check_back }) }, writer);
        if (done === null) return { text: `There is no increment ${waiter} in this project's plan.`, refused: true };
        // Waiting on the owner lets go of the work it holds (ADR-0944 D4); an outside event does not.
        const released = releaser === "owner" ? await releaseAsked(claimContext(call), waiter) : [];
        return { text: `${waiter} now waits for ${releasedBy(releaser)}: ${note}${check_back === undefined ? "" : ` (check back ${check_back})`}.${releasedSaid(released)}`, data: { id: waiter, released } };
      }
      if (on === undefined || releaser !== undefined || reason === undefined) return { text: "Give either `on` and `reason` (work it waits on) or `for` and `note` (the owner or an outside event it waits for).", refused: true };
      const done = await library.addWait(waiter, on, reason, writer);
      if (done === null) return { text: `There is no increment or arc ${waiter} in this project's plan.`, refused: true };
      return { text: `${waiter} now waits on ${on}: ${reason}.`, data: { id: waiter } };
    },
  );

  define(
    "clear_wait",
    "Stop an increment or arc waiting on another (`on`), or an increment waiting for the owner or an outside event (`for`).",
    z.object({
      waiter: z.string().min(1).describe("The id of the increment or arc that waits"),
      on: z.string().min(1).optional().describe("The id of what it waits on; or give `for` instead"),
      for: z.enum(["owner", "event"]).optional().describe("Instead of `on`: stop it waiting for the owner, or for an outside event"),
    }),
    async ({ waiter, on, for: releaser }, { library, writer }) => {
      if ((on === undefined) === (releaser === undefined)) return { text: "Give either `on` (work it waits on) or `for` (the owner or an outside event).", refused: true };
      const done = on !== undefined ? await library.removeWait(waiter, on, writer) : await library.removeWaitFor(waiter, releaser!, writer);
      if (done === null) return { text: `There is no increment or arc ${waiter} in this project's plan.`, refused: true };
      return { text: `${waiter} no longer waits ${on !== undefined ? `on ${on}` : `for ${releasedBy(releaser!)}`}.`, data: { id: waiter } };
    },
  );

  define(
    "raise_question",
    "Raise a question for the owner on an arc, instead of only asking in chat: what is at stake, the question, the context they need to answer it cold, and the options. Name the increments that cannot go on until they answer: those wait on the owner until it is settled, and your claims on those on this arc, with the capabilities you took for them, are released.",
    z.object({
      arc: id("arc"),
      title: z.string().min(1).describe("A short name for it"),
      stakes: z.string().min(1).describe("What hangs on the answer"),
      statement: z.string().min(1).describe("The question itself"),
      context: z.string().min(1).describe("What the owner needs to know to answer it"),
      options: z.string().min(1).describe("The options the owner has"),
      recommendation: z.string().min(1).optional().describe("Which option you recommend, and why"),
      holds: z.array(z.string().min(1)).optional().describe("The ids of the increments held until the owner answers"),
    }),
    async ({ holds, ...asked }, call) => {
      const { library, writer } = call;
      // Check the entire request before the first write: a refusal must leave no question or hold.
      const holding = new Map<string, { heldOn: string[]; arc: string }>();
      for (const increment of holds ?? []) {
        const held = await heldOn(library, increment);
        if (held === undefined) return { text: `There is no increment ${increment} to hold on the question. Nothing was written.`, refused: true };
        holding.set(increment, held);
      }
      const question = await library.raiseQuestion(defined(asked), writer);
      const released: string[] = [];
      for (const [increment, held] of holding) {
        await library.editIncrement(increment, { heldOn: [...held.heldOn, question.id] }, writer);
        // Asking about work this session holds lets go of it; a question about another arc releases nothing (ADR-0944 D4).
        if (held.arc === asked.arc) released.push(...(await releaseAsked(claimContext(call), increment)));
      }
      const waiting = holding.size === 0 ? "" : ` ${[...holding.keys()].join(", ")} ${holding.size === 1 ? "waits" : "wait"} on the answer.`;
      return { text: `Raised ${quoted(asked.title)} (${question.id}) on the arc for the owner.${waiting}${releasedSaid(released)}`, data: { id: question.id, released } };
    },
  );

  define(
    "correct_question",
    "Correct an open question's wording in place: change only the fields you give. It keeps its id and its arc. A settled question keeps its words, since its answer was given to them.",
    z.object({
      question: id("question"),
      title: z.string().min(1).optional().describe("A short name for it"),
      stakes: z.string().min(1).optional().describe("What hangs on the answer"),
      statement: z.string().min(1).optional().describe("The question itself"),
      context: z.string().min(1).optional().describe("What the owner needs to know to answer it"),
      options: z.string().min(1).optional().describe("The options the owner has"),
      analogy: z.string().min(1).optional().describe("An analogy, saying where it breaks"),
      diagram: z.string().min(1).optional().describe("A diagram of the structure or flow it is about"),
      recommendation: z.string().min(1).optional().describe("Which option you recommend, and why"),
    }),
    async ({ question, ...wording }, { library, writer }) => {
      const fields = defined(wording);
      if (Object.keys(fields).length === 0) return { text: "Give the words to change: title, stakes, statement, context, options, analogy, diagram or recommendation.", refused: true };
      const corrected = await library.editQuestion(question, fields, writer);
      if (corrected === null) return { text: `There is no question ${question} in this project.`, refused: true };
      return { text: `Corrected ${quoted(corrected.fields.title)} (${question}).`, data: { id: question } };
    },
  );

  define(
    "settle_question",
    "Settle a question with the owner's answer, in their own words, and the decision that carried it if one did. Work held on it goes on.",
    z.object({
      question: id("question"),
      answer: z.string().min(1).describe("The owner's answer, in their own words"),
      decision: z.string().min(1).optional().describe("The id of the decision that carried it"),
    }),
    async ({ question, answer, decision }, { library, writer }) => {
      const settled = await library.settleQuestion(question, defined({ answer, decision }), writer);
      if (settled === null) return { text: `There is no question ${question} in this project.`, refused: true };
      return { text: `Settled ${quoted(settled.fields.title)} (${question}). Work held on it goes on.`, data: { id: question } };
    },
  );

  define(
    "retire_question",
    "Retire a question that was wrong to ask, with the reason. One that was answered is settled instead, and one that work is held on cannot be retired.",
    z.object({ question: id("question"), reason: z.string().min(1).describe("Why it was wrong to ask") }),
    async ({ question, reason }, { library, writer }) => {
      await library.retire(question, reason, writer);
      return { text: `Retired question ${question}.`, data: { id: question } };
    },
  );

  define(
    "record_friction",
    "Record friction: something that got in the way, with concrete evidence (a path, a pull request, a commit, a command and its output, an error, or a quoted excerpt) and what it cost. Record it; do not decide what to do about it.",
    z.object({
      title: z.string().min(1).describe("A short name for it"),
      description: z.string().min(1).describe("One line on what it is"),
      statement: z.string().min(1).describe("What went wrong"),
      evidence: z.string().min(1).describe("The concrete evidence for it"),
      impact: z.string().min(1).describe("What it cost"),
    }),
    async (fields, { library, folder, writer }) => {
      const friction = await recordFriction(library, { ...fields, branch: captureBranch(folder) }, writer);
      return { text: `Recorded friction ${quoted(fields.title)} (${friction.id}).`, data: { id: friction.id } };
    },
  );

  define(
    "reinforce",
    "Record a recurrence of existing friction with its own concrete evidence. It appends the date and this session's branch, keeping the original item and its route.",
    z.object({ friction: id("friction"), evidence: z.string().min(1).describe("Concrete evidence of what happened this time") }),
    async ({ friction, evidence }, { library, folder, writer }) => {
      const saved = await reinforceFriction(library, friction, { branch: currentBranch(folder) ?? "(no branch)", evidence }, writer);
      return { text: `Reinforced friction ${quoted(saved.fields.title)} (${saved.id}).`, data: { id: saved.id } };
    },
  );

  define(
    "record_resteer",
    "Record a re-steer: the user (the project's owner) redirected what you were doing. Put their own words inside double quotation marks as the evidence; your own account of it goes in self_report. Say whether it was a defect or a matter of taste, and who judged that: the owner, or you. A defect needs its failure mode (no-mast-home when none fits).",
    z.object({
      title: z.string().min(1).describe("A short name for it"),
      description: z.string().min(1).describe("One line on what it is"),
      doing: z.string().min(1).describe("What you were doing"),
      redirect: z.string().min(1).describe("What the owner redirected you to"),
      evidence: z.string().min(1).describe('Their own words, inside double quotation marks: "…"'),
      self_report: z.string().min(1).optional().describe("Your own account of it"),
      disposition: z.enum(["defect", "taste"]).describe("defect: something went wrong; taste: a preference"),
      judged_by: z.enum(["owner", "agent"]).describe("Who judged it a defect or taste: owner only when the owner said so"),
      mode: z.string().min(1).optional().describe("A defect's failure mode"),
    }),
    async ({ self_report: selfReport, judged_by: dispositionBy, ...fields }, { library, writer }) => {
      const resteer = await recordResteer(library, defined({ ...fields, selfReport, dispositionBy }), writer);
      return { text: `Recorded re-steer ${quoted(fields.title)} (${resteer.id}).`, data: { id: resteer.id } };
    },
  );
}

/** Capture also knows the branch of a repository that has no first commit yet. */
function captureBranch(folder: string): string {
  return currentBranch(folder) ?? "(no branch)";
}

/** The questions increment `id` is held on now, and its arc, or undefined when it is not a live increment. */
async function heldOn(library: Library, id: string): Promise<{ heldOn: string[]; arc: string } | undefined> {
  const increment = (await increments(library)).find((one) => one.id === id);
  return increment === undefined ? undefined : { heldOn: increment.fields.heldOn ?? [], arc: increment.fields.arc };
}

/** What asking the owner released, in a sentence, or nothing when it released nothing. */
function releasedSaid(released: readonly string[]): string {
  return released.length === 0 ? "" : ` Released your claims on ${released.join(", ")}: the owner holds it now.`;
}

function noIncrement(increment: string): Answer {
  return { text: `There is no increment ${increment} in this project's plan.`, refused: true };
}

async function arcName(library: Library, arc: string): Promise<string> {
  const view = await library.arcView(arc);
  return view === null ? arc : `${quoted(view.arc.fields.title)} (${arc})`;
}

/** An optional arc read cannot turn a committed write into a refusal or hide its result. */
async function afterWrite(saved: Answer, followUp: () => Promise<Answer>): Promise<Answer> {
  try {
    return await followUp();
  } catch (error) {
    // Keep the library's recovery advice, including NewerSchemaError's update instructions.
    return { ...saved, text: `${saved.text} The follow-up arc read failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function claimContext({ log, library, project, caller, folder, quietMs }: Call) {
  return { log, library, project, ...lineOf(caller), folder, quietMs };
}

/** `fields` without the ones left undefined. */
function defined<T extends Record<string, unknown>>(fields: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

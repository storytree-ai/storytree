/**
 * The work tools (ADR-0643 D1, 6): park, ready and close increments, park and unpark arcs, set and
 * clear waits, raise, settle and retire the owner's questions, and record friction and re-steers. Each is a thin wrapper over the library's own
 * functions, or this story's capture functions over them, so no library rule is kept here twice.
 * Starting an increment is claiming it (claim-tools.ts), so a start is refused as a claim is.
 *
 * There is no hand close or re-open of an arc (ADR-0640 R1, 10-b): an arc reads closed when its
 * last increment closes, which close_increment says, and re-opens when work is parked on it, which
 * park_increment says.
 */
import type { Library } from "@storytree/library";
import { z } from "zod";

import { recordFriction, recordResteer, reinforceFriction } from "../capture/index.js";
import { closed, currentBranch, increments } from "../claims/index.js";
import { lineOf, type Answer, type Call, type Define } from "./server.js";
import { quoted } from "./text.js";

const id = (what: string) => z.string().min(1).describe(`The id of the ${what}, as the plan shows it`);
const disposition = z.enum(["landed", "failed", "withdrawn"]).describe("What the close meant: landed, failed, or withdrawn");
const pr = z.string().min(1).optional().describe("Its pull request, such as #12");
const note = z.string().min(1).optional().describe("Why it closed: needed when there is no pull request");

export function registerWorkTools(define: Define): void {
  define(
    "park_increment",
    "Park an increment of work on an arc, as a proposal: what it is, its objective, and its breakdown in the body. Name the stories and capabilities it touches. To record work that landed without ever being parked, give its outcome, and it is born closed. Parking work on a closed arc re-opens it.",
    z.object({
      arc: id("arc"),
      title: z.string().min(1).describe("What it is called: a short name"),
      objective: z.string().min(1).describe("What it delivers, in a sentence"),
      body: z.string().min(1).describe("The increment itself: how the work breaks down"),
      touches: z.array(z.string().min(1)).optional().describe("The ids of the stories and capabilities it touches"),
      outcome: z.object({ disposition, pr, note }).optional().describe("Only for work that already landed without being parked: how it closed"),
    }),
    async ({ arc, title, objective, body, touches, outcome }, { library, writer }) => {
      const before = (await library.arcView(arc))?.state;
      const increment = await library.addIncrement({
        arc,
        title,
        objective,
        body,
        ...(touches === undefined ? {} : { touches }),
        ...(outcome === undefined ? {} : { outcome: defined(outcome) }),
      }, writer);
      const reopened = before === "closed" && (await library.arcView(arc))?.state === "active" ? ` Its arc ${await arcName(library, arc)} re-opens.` : "";
      const said = outcome === undefined ? `Parked ${quoted(title)} (${increment.id}) as a proposal. Claim it to start it.` : `Recorded ${quoted(title)} (${increment.id}), ${outcome.disposition}.`;
      return { text: `${said}${reopened}`, data: { id: increment.id } };
    },
  );

  define("ready_increment", "Mark a proposed increment ready: planned and able to start.", z.object({ increment: id("increment") }), async ({ increment }, { library, writer }) => {
    const readied = await library.advanceIncrement(increment, "ready", writer);
    if (readied === null) return noIncrement(increment);
    return { text: `${quoted(readied.fields.title)} (${increment}) is ready. Claim it to start it.`, data: { id: increment } };
  });

  define(
    "close_increment",
    "Close an increment with its outcome: landed, failed or withdrawn, with its pull request, or a note when there is none. Any claim on it ends.",
    z.object({ increment: id("increment"), disposition, pr, note }),
    async ({ increment, disposition: meant, pr: pull, note: why }, call) => {
      const done = await call.library.closeIncrement(increment, defined({ disposition: meant, pr: pull, note: why }), call.writer);
      if (done === null) return noIncrement(increment);
      await closed(claimContext(call), increment, meant);
      const view = await call.library.arcView(done.fields.arc);
      const arc = view?.state === "closed" ? ` Its arc ${await arcName(call.library, done.fields.arc)} now reads closed: that was its last open increment.` : "";
      return { text: `Closed ${quoted(done.fields.title)} (${increment}), ${meant}.${arc}`, data: { id: increment } };
    },
  );

  define(
    "park_arc",
    "Park an arc, so that it reads parked whatever its work, or unpark it (parked: false).",
    z.object({ arc: id("arc"), parked: z.boolean().describe("true to park it, false to unpark it") }),
    async ({ arc, parked }, { library, writer }) => {
      const done = parked ? await library.parkArc(arc, writer) : await library.unparkArc(arc, writer);
      if (done === null) return { text: `There is no arc ${arc} in this project's plan.`, refused: true };
      return { text: parked ? `Parked arc ${quoted(done.fields.title)} (${arc}).` : `Unparked arc ${quoted(done.fields.title)} (${arc}).`, data: { id: arc } };
    },
  );

  define(
    "set_wait",
    "Make an increment wait on another increment, on any arc, or an arc on another arc, with the reason. Waiting work cannot be claimed or started until the wait releases.",
    z.object({
      waiter: z.string().min(1).describe("The id of the increment or arc that waits"),
      on: z.string().min(1).describe("The id of the increment or arc it waits on"),
      reason: z.string().min(1).describe("Why it waits, in a line"),
    }),
    async ({ waiter, on, reason }, { library, writer }) => {
      const done = await library.addWait(waiter, on, reason, writer);
      if (done === null) return { text: `There is no increment or arc ${waiter} in this project's plan.`, refused: true };
      return { text: `${waiter} now waits on ${on}: ${reason}.`, data: { id: waiter } };
    },
  );

  define(
    "clear_wait",
    "Stop an increment or arc waiting on another.",
    z.object({ waiter: z.string().min(1).describe("The id of the increment or arc that waits"), on: z.string().min(1).describe("The id of what it waits on") }),
    async ({ waiter, on }, { library, writer }) => {
      const done = await library.removeWait(waiter, on, writer);
      if (done === null) return { text: `There is no increment or arc ${waiter} in this project's plan.`, refused: true };
      return { text: `${waiter} no longer waits on ${on}.`, data: { id: waiter } };
    },
  );

  define(
    "raise_question",
    "Raise a question for the owner on an arc, instead of only asking in chat: what is at stake, the question, the context they need to answer it cold, and the options. Name the increments that cannot go on until they answer: those wait on the owner until it is settled.",
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
    async ({ holds, ...asked }, { library, writer }) => {
      const question = await library.raiseQuestion(defined(asked), writer);
      for (const increment of holds ?? []) {
        const held = await heldOn(library, increment);
        if (held === undefined) return { text: `Raised ${quoted(asked.title)} (${question.id}), but there is no increment ${increment} to hold on it.`, refused: true, data: { id: question.id } };
        await library.editIncrement(increment, { heldOn: [...held, question.id] }, writer);
      }
      const holding = holds === undefined || holds.length === 0 ? "" : ` ${holds.join(", ")} ${holds.length === 1 ? "waits" : "wait"} on the answer.`;
      return { text: `Raised ${quoted(asked.title)} (${question.id}) on the arc for the owner.${holding}`, data: { id: question.id } };
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
    async (fields, { library, writer }) => {
      const friction = await recordFriction(library, fields, writer);
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
    "Record a re-steer: the owner redirected what you were doing. Quote their own words as the evidence; your own account of it goes in self_report. Say whether it was a defect or a matter of taste, and who judged that: the owner, or you. A defect needs its failure mode (no-mast-home when none fits).",
    z.object({
      title: z.string().min(1).describe("A short name for it"),
      description: z.string().min(1).describe("One line on what it is"),
      doing: z.string().min(1).describe("What you were doing"),
      redirect: z.string().min(1).describe("What the owner redirected you to"),
      evidence: z.string().min(1).describe("His own words, quoted"),
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

/** The questions increment `id` is held on now, or undefined when it is not a live increment. */
async function heldOn(library: Library, id: string): Promise<string[] | undefined> {
  const increment = (await increments(library)).find((one) => one.id === id);
  return increment === undefined ? undefined : (increment.fields.heldOn ?? []);
}

function noIncrement(increment: string): Answer {
  return { text: `There is no increment ${increment} in this project's plan.`, refused: true };
}

async function arcName(library: Library, arc: string): Promise<string> {
  const view = await library.arcView(arc);
  return view === null ? arc : `${quoted(view.arc.fields.title)} (${arc})`;
}

function claimContext({ log, library, project, caller, folder, quietMs }: Call) {
  return { log, library, project, ...lineOf(caller), folder, quietMs };
}

/** `fields` without the ones left undefined. */
function defined<T extends Record<string, unknown>>(fields: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

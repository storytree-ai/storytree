/**
 * Capability 4 · Triage. The `feedback` verbs the two-hourly session manager triages the owner's notes with
 * (question_aef9cf65f529): `feedback list` the new ones (4.1), `feedback show` one whole with its screenshot (4.3), and
 * `feedback route` it to an increment, a question or a reasoned close (4.2). Declared here and named under `verbs` in the
 * package's manifest, so the command line mounts them as its `feedback` family.
 */
import { writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

import type { FeedbackRoute, SchemaRecord } from "@storytree/library";
import { verb, VerbRefusal, type VerbContext, type VerbFamily } from "@storytree/library/verbs";

const NO_TOOL = "feedback is triaged by the session manager at the command line";
const ROUTES = ["increment", "question", "closed"] as const;

type Note = SchemaRecord<"feedback">;

/** `word` with its article: "an increment", "a question". */
const a = (word: string): string => `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}`;

/** A note's one line: when, where, and what he wrote, its first line cut at 100 characters. */
function lineOf({ id, fields }: Note): string {
  const text = fields.text.split(/\r?\n/, 1)[0] ?? "";
  const where = fields.story === undefined ? fields.surface : `${fields.surface} (${fields.story})`;
  const routed = fields.status === "routed" ? `  → ${fields.route}${fields.routedTo === undefined ? "" : ` ${fields.routedTo}`}: ${fields.routeReason}` : "";
  return `  ${id}  ${fields.at}  ${where}${fields.screenshot ? "  [screenshot]" : ""}\n    ${text.length > 100 ? `${text.slice(0, 99)}…` : text}${routed}`;
}

/** The live feedback note `id`, or a refusal naming what it is instead. */
async function noteOf(context: VerbContext, id: string): Promise<Note> {
  const record = await context.library.get(id);
  if (record === null) throw new VerbRefusal(`no feedback note "${id}" in this project`, { next: [{ command: "feedback list", why: "see the notes waiting" }] });
  if (record.type !== "feedback") throw new VerbRefusal(`${id} is ${a(record.type)}, not a feedback note`);
  return record as Note;
}

const list = verb({
  consumers: ["agent"],
  command: { family: "feedback", name: "list", summary: "the owner's feedback notes waiting to be routed, oldest first; with --all, the routed ones too, each with its route", usage: "feedback list [--all]" },
  tool: { absent: NO_TOOL },
  inputs: { all: { kind: "switch", describe: "the routed notes too, each with where it went and why" } },
  async act({ all }, context: VerbContext) {
    const notes = (await context.library.list("feedback")).filter(({ fields }) => all || fields.status === "new").sort((a, b) => a.fields.at.localeCompare(b.fields.at));
    if (notes.length === 0) return { text: all ? "No feedback notes." : "No feedback notes wait to be routed." };
    const waiting = notes.filter(({ fields }) => fields.status === "new").length;
    return {
      text: [`${waiting} feedback note${waiting === 1 ? "" : "s"} wait${waiting === 1 ? "s" : ""} to be routed${all ? `, ${notes.length - waiting} routed` : ""}:`, ...notes.map(lineOf)].join("\n"),
      next: [
        { command: "feedback show <feedback> --screenshot <file>", why: "read one whole, with the picture of the window" },
        { command: "feedback route <feedback> --to increment|question|closed --reason <why>", why: "record where it went" },
      ],
    };
  },
});

const show = verb({
  consumers: ["agent"],
  command: { family: "feedback", name: "show", summary: "read one feedback note whole, with the element it points at, and, given a file, save the picture of the window it was sent from and the one cut to its element beside it", usage: "feedback show <feedback> [--screenshot <file.jpg>]" },
  tool: { absent: NO_TOOL },
  inputs: {
    feedback: { kind: "text", word: 0, describe: "the note's id" },
    screenshot: { kind: "text", optional: true, describe: "a file to save its screenshot to, as a JPEG; the element's crop is saved beside it as <file>.element.jpg" },
  },
  async act({ feedback, screenshot }, context: VerbContext) {
    const note = await noteOf(context, feedback);
    const { fields } = note;
    const lines = [
      `${note.id}  [feedback]  ${fields.status}`,
      `at: ${fields.at}`,
      `surface: ${fields.surface}`,
      ...(fields.story === undefined ? [] : [`story: ${fields.story}`]),
      ...(fields.selection === undefined ? [] : [`selection: ${fields.selection}`]),
      ...(fields.project === undefined ? [] : [`project: ${fields.project}`]),
      `version: ${fields.version}`,
      `window: ${fields.window.width}×${fields.window.height}, ${fields.theme}`,
      ...(fields.anchor === undefined ? [] : anchorLines(fields.anchor)),
      ...(fields.route === undefined ? [] : [`route: ${fields.route}${fields.routedTo === undefined ? "" : ` ${fields.routedTo}`}`, `reason: ${fields.routeReason}`]),
      `text: ${fields.text}`,
    ];
    if (screenshot !== undefined) {
      const jpeg = await context.library.feedbackScreenshot(note.id);
      if (jpeg === null) {
        lines.push("screenshot: none was sent with this note");
      } else {
        const file = resolve(context.folder, screenshot);
        await writeFile(file, jpeg);
        lines.push(`screenshot: saved to ${file}`);
        const crop = await context.library.feedbackScreenshot(note.id, { element: true });
        if (crop !== null) {
          const beside = `${file.slice(0, file.length - extname(file).length)}.element.jpg`;
          await writeFile(beside, crop);
          lines.push(`element picture: saved to ${beside}`);
        }
      }
    } else {
      lines.push(`screenshot: ${fields.screenshot ? "yes; save it with --screenshot <file.jpg>" : "none"}`);
    }
    return { text: lines.join("\n") };
  },
});

/** The element a note points at, a line a fact: what a building agent searches the code with. */
function anchorLines(anchor: NonNullable<Note["fields"]["anchor"]>): string[] {
  const { box } = anchor;
  return [
    `element: ${anchor.selector}`,
    `  ${anchor.tag}${anchor.role === undefined ? "" : `, role ${anchor.role}`}${anchor.name === undefined ? "" : `, named ${JSON.stringify(anchor.name)}`}, ${box.width}×${box.height} at ${box.x},${box.y}`,
    ...(anchor.text === undefined ? [] : [`  text: ${anchor.text}`]),
    ...(anchor.components.length === 0 ? [] : [`  components: ${anchor.components.join(" < ")}`]),
    ...(anchor.marks.length === 0 ? [] : [`  marks: ${anchor.marks.join(" ")}`]),
    ...(Object.keys(anchor.styles).length === 0 ? [] : [`  styles: ${Object.entries(anchor.styles).map(([name, value]) => `${name}: ${value}`).join("; ")}`]),
    `  html: ${anchor.html}`,
  ];
}

const route = verb({
  consumers: ["agent"],
  command: {
    family: "feedback",
    name: "route",
    summary: "record where a new feedback note went: the increment or question made for it, or closed, with why",
    usage: "feedback route <feedback> --to increment|question|closed [--target <increment|question>] --reason <why>",
  },
  tool: { absent: NO_TOOL },
  inputs: {
    feedback: { kind: "text", word: 0, describe: "the note's id" },
    to: { kind: "text", describe: "increment, question or closed" },
    target: { kind: "text", optional: true, describe: "the increment or question it went to; none for closed" },
    reason: { kind: "text", describe: "why it went there: the owning arc, or for closed what already covers it" },
  },
  writes: true,
  async act({ feedback, to, target, reason }, context: VerbContext) {
    if (!(ROUTES as readonly string[]).includes(to)) throw new VerbRefusal(`--to is one of ${ROUTES.join(", ")}, not "${to}"`, { misuse: true });
    const kind = to as FeedbackRoute["route"];
    if (kind === "closed" && target !== undefined) throw new VerbRefusal("a closed note goes to no --target: name what covers it in --reason", { misuse: true });
    if (kind !== "closed") {
      if (target === undefined) throw new VerbRefusal(`a note routed to ${a(kind)} names it with --target`, { misuse: true });
      const record = await context.library.get(target);
      if (record?.type !== kind) throw new VerbRefusal(`${target} is ${record === null ? "no live record" : a(record.type)}, not ${a(kind)}`);
    }
    const note = await noteOf(context, feedback);
    if (note.fields.status !== "new") throw new VerbRefusal(`${note.id} is already routed: ${note.fields.route}${note.fields.routedTo === undefined ? "" : ` ${note.fields.routedTo}`}`);
    await context.library.routeFeedback(note.id, { route: kind, routeReason: reason, ...(target === undefined ? {} : { routedTo: target }) }, context.writer);
    return { text: `Routed ${note.id} to ${kind === "closed" ? "closed" : `${kind} ${target}`}.`, next: [{ command: "feedback list", why: "see the notes still waiting" }] };
  },
});

/** The `feedback` family, beside `friction` and `resteer`. */
export const FEEDBACK_FAMILIES: readonly VerbFamily[] = [
  { name: "feedback", summary: "the owner's feedback notes from the app's corner button: list the new ones, read one with its screenshot, route it", order: 14.5, verbs: [list, show, route] },
];

/**
 * Capability 4 · Triage: contracts 4.1 to 4.3, the `feedback` verbs, run with a caller on a fresh project's library on
 * the real Postgres `pnpm test` provides.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import { connect, type FeedbackNote, type Library } from "@storytree/library";
import { VerbRefusal, type DoorWords, type Verb, type VerbContext, type VerbInputs } from "@storytree/library/verbs";

import { FEEDBACK_FAMILIES } from "./verbs.js";

const WORDS: DoorWords = { door: "command", say: (step) => `storytree ${step.command}` };
const verbOf = (name: string) => FEEDBACK_FAMILIES[0]!.verbs.find((one) => "name" in one.command && one.command.name === name) as Verb<VerbInputs, VerbContext>;
const [list, show, route] = [verbOf("list"), verbOf("show"), verbOf("route")];

/** A fresh project's library, dropped when the test ends, and a caller's context on it in a throwaway folder. */
async function aProject(t: TestContext): Promise<{ library: Library; context: VerbContext }> {
  const url = process.env.STORYTREE_TEST_PG_URL;
  if (url === undefined) throw new Error("run the tests via `pnpm test`, which starts a local Postgres");
  const storytree = await connect({ url });
  const project = `t-${randomBytes(4).toString("hex")}`;
  const library = await storytree.openProject(project);
  const folder = await mkdtemp(join(tmpdir(), "feedback-"));
  t.after(async () => {
    try {
      await storytree.dropProject(project);
    } finally {
      await storytree.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
  return { library, context: { library, project, session: "person:test", folder, writer: { actor: "session:manager" } } };
}

const note = (text: string, at: string): FeedbackNote => ({ text, surface: "arcs", story: "story_000000000001", version: "0.3.99", window: { width: 1440, height: 960 }, theme: "dark", at });

test("4.1 · `feedback list` shows each new feedback note, oldest first, with its id, time, surface, story and text, and whether it has a screenshot; routed notes only with --all, each with its route", async (t) => {
  const { library, context } = await aProject(t);
  assert.equal((await list.act({ all: false }, context, WORDS)).text, "No feedback notes wait to be routed.");

  const later = await library.sendFeedback(note("The drawer hides the island", "2026-10-24T10:00:00.000Z"), { screenshot: Uint8Array.from([0xff, 0xd8]) });
  const earlier = await library.sendFeedback(note("The gear menu is slow", "2026-10-24T09:00:00.000Z"));
  const done = await library.sendFeedback(note("Already handled", "2026-10-24T08:00:00.000Z"));
  await library.routeFeedback(done.id, { route: "closed", routeReason: "Covered by increment_000000000009" });

  const waiting = (await list.act({ all: false }, context, WORDS)).text;
  assert.match(waiting, /^2 feedback notes wait to be routed:/);
  assert.ok(waiting.indexOf(earlier.id) < waiting.indexOf(later.id), "oldest first");
  assert.ok(!waiting.includes(done.id), "a routed note is not offered again");
  assert.match(waiting, new RegExp(`${later.id}  2026-10-24T10:00:00.000Z  arcs \\(story_000000000001\\)  \\[screenshot\\]\\n    The drawer hides the island`));
  assert.match(waiting, new RegExp(`${earlier.id}  2026-10-24T09:00:00.000Z  arcs \\(story_000000000001\\)\\n    The gear menu is slow`));

  const all = (await list.act({ all: true }, context, WORDS)).text;
  assert.match(all, /^2 feedback notes wait to be routed, 1 routed:/);
  assert.match(all, new RegExp(`${done.id}.*\\n    Already handled  → closed: Covered by increment_000000000009`));
});

test("4.2 · `feedback route <feedback> --to increment|question|closed --reason` marks a new note routed with its route, target and reason; an increment or question target must be a live record of that kind, an already routed note or a non-feedback id is refused with nothing written", async (t) => {
  const { library, context } = await aProject(t);
  const arc = await library.createArc({ title: "Arcs drawer", intent: "An intent", endState: "An end state" });
  const work = await library.addIncrement({ arc: arc.id, title: "Keep the island in view", objective: "It stays in view", body: "…" });
  const sent = await library.sendFeedback(note("The drawer hides the island", "2026-10-24T10:00:00.000Z"));
  const refused = async (input: Record<string, string>, pattern: RegExp) => {
    await assert.rejects(route.act(input, context, WORDS), (error: Error) => error instanceof VerbRefusal && pattern.test(error.message));
    assert.equal(((await library.get(sent.id))!.fields as Record<string, unknown>).status, "new", "a refusal writes nothing");
  };

  await refused({ feedback: sent.id, to: "question", target: work.id, reason: "r" }, /is an increment, not a question/);
  await refused({ feedback: sent.id, to: "increment", reason: "r" }, /--target/);
  await refused({ feedback: sent.id, to: "closed", target: work.id, reason: "r" }, /no --target/);
  await refused({ feedback: sent.id, to: "elsewhere", reason: "r" }, /--to is one of/);
  await refused({ feedback: arc.id, to: "closed", reason: "r" }, /is an arc, not a feedback note/);
  await refused({ feedback: "feedback_000000000000", to: "closed", reason: "r" }, /no feedback note/);

  const answer = await route.act({ feedback: sent.id, to: "increment", target: work.id, reason: "The arcs drawer's arc owns it" }, context, WORDS);
  assert.equal(answer.text, `Routed ${sent.id} to increment ${work.id}.`);
  const routed = (await library.get(sent.id))!;
  const fields = routed.fields as Record<string, unknown>;
  assert.deepEqual([fields.status, (routed.fields as Record<string, unknown>).route, (routed.fields as Record<string, unknown>).routedTo, (routed.fields as Record<string, unknown>).routeReason], ["routed", "increment", work.id, "The arcs drawer's arc owns it"]);
  assert.equal((await library.history({ id: sent.id })).at(-1)!.actor, "session:manager");

  await assert.rejects(route.act({ feedback: sent.id, to: "closed", reason: "again" }, context, WORDS), (error: Error) => error instanceof VerbRefusal && /already routed: increment/.test(error.message));
  assert.equal(((await library.get(sent.id))!.fields as Record<string, unknown>).route, "increment", "a second route writes nothing");
});

test("4.3 · `feedback show <feedback> [--screenshot <file>]` prints the note whole with the element it points at and, given a file, writes its screenshot JPEG there and the element's crop beside it; a note sent without one says so", async (t) => {
  const { library, context } = await aProject(t);
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const crop = Uint8Array.from([0xff, 0xd8, 7, 0xff, 0xd9]);
  const anchor = {
    selector: "#arcs > button:nth-of-type(2)",
    tag: "button",
    role: "button",
    name: "Close",
    text: "Close now",
    marks: ['section[data-surface-id="arcs"]'],
    components: ["CloseButton", "ArcsDrawer"],
    box: { x: 10, y: 20, width: 60, height: 24 },
    styles: { color: "rgb(1, 2, 3)", "font-size": "15px" },
    html: '<button type="button">Close <b>now</b></button>',
  };
  const pictured = await library.sendFeedback({ ...note("The drawer hides the island\nwhen I click it", "2026-10-24T10:00:00.000Z"), selection: "story_000000000002", project: "site", anchor }, { screenshot: jpeg, crop });
  const plain = await library.sendFeedback(note("No picture", "2026-10-24T11:00:00.000Z"));

  const shown = (await show.act({ feedback: pictured.id, screenshot: "shot.jpg" }, context, WORDS)).text;
  for (const line of ["surface: arcs", "story: story_000000000001", "selection: story_000000000002", "project: site", "version: 0.3.99", "window: 1440×960, dark", "text: The drawer hides the island\nwhen I click it"]) {
    assert.ok(shown.includes(line), `shows ${line}`);
  }
  assert.ok(shown.includes([
    "element: #arcs > button:nth-of-type(2)",
    '  button, role button, named "Close", 60×24 at 10,20',
    "  text: Close now",
    "  components: CloseButton < ArcsDrawer",
    '  marks: section[data-surface-id="arcs"]',
    "  styles: color: rgb(1, 2, 3); font-size: 15px",
    '  html: <button type="button">Close <b>now</b></button>',
  ].join("\n")), `shows the element:\n${shown}`);
  assert.ok(shown.includes(`screenshot: saved to ${join(context.folder, "shot.jpg")}`));
  assert.deepEqual(new Uint8Array(await readFile(join(context.folder, "shot.jpg"))), jpeg);
  assert.ok(shown.includes(`element picture: saved to ${join(context.folder, "shot.element.jpg")}`));
  assert.deepEqual(new Uint8Array(await readFile(join(context.folder, "shot.element.jpg"))), crop);

  assert.match((await show.act({ feedback: plain.id, screenshot: "none.jpg" }, context, WORDS)).text, /screenshot: none was sent with this note/);
  await assert.rejects(readFile(join(context.folder, "none.jpg")), { code: "ENOENT" });
  assert.match((await show.act({ feedback: pictured.id }, context, WORDS)).text, /screenshot: yes; save it with --screenshot/);
});

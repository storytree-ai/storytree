import assert from "node:assert/strict";
import { test } from "node:test";

import type { FeedbackNote } from "@storytree/library";

import { FEEDBACK_CHANNELS } from "./bridge.js";
import { CROP_MARGIN, createFeedbackRuntime, feedbackPageAnswers, type FeedbackPageFrame } from "./runtime.js";

const SURFACES = [
  { id: "globe", name: "Forest globe", story: "forest" },
  { id: "arcs", name: "Arcs", story: "arc-surface" },
  { id: "menu:help", name: "App menu: Help", story: "app" },
];
const ANCHOR = {
  selector: "#arcs > button:nth-of-type(2)",
  tag: "button",
  role: "button",
  name: "Close",
  marks: ['section[data-surface-id="arcs"]'],
  components: ["ArcsDrawer"],
  box: { x: 10, y: 20, width: 60, height: 24 },
  styles: { color: "rgb(236, 234, 227)" },
  html: '<button type="button">Close</button>',
};
const NOTE = { text: "The drawer hides the island", surface: "arcs", anchor: ANCHOR, selection: "story_000000000001", project: "site", window: { width: 1440, height: 960 }, theme: "dark" } as const;
const JPEG = Uint8Array.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]);

/** A frame whose library is a stand-in that keeps what it is sent, holding the projects named. */
function frame(projects: readonly string[], capture: FeedbackPageFrame["captureWindow"] = async () => JPEG) {
  const sent: { note: FeedbackNote; screenshot: Uint8Array | undefined; crop: Uint8Array | undefined; actor: string | undefined }[] = [];
  const opened: string[] = [];
  const server: ReturnType<FeedbackPageFrame["server"]> = {
    listProjects: async () => [...projects],
    openProject: async (name) => {
      opened.push(name);
      return { sendFeedback: async (note, options) => { sent.push({ note, screenshot: options?.screenshot, crop: options?.crop, actor: options?.actor }); return { id: `feedback_00000000000${sent.length}` } as never; } };
    },
  };
  const given: FeedbackPageFrame = { appVersion: "0.3.99", declaredSurfaces: SURFACES, server: () => server, captureWindow: capture };
  return { given, sent, opened };
}

test("3.1 · sending writes one feedback record in project storytree with the text, surface, its story, the element it points at, selection, project viewed, version, window size, theme, time and status new", async () => {
  const { given, sent, opened } = frame(["site", "storytree"]);
  const runtime = createFeedbackRuntime(given, { now: () => new Date("2026-10-21T12:00:00.000Z") });
  assert.deepEqual(await runtime.feedbackSetup(), { offered: true, surfaces: SURFACES });

  assert.deepEqual(await runtime.sendFeedback(NOTE), { id: "feedback_000000000001" });
  assert.deepEqual(opened, ["storytree"], "notes go to project storytree, whichever project is on show");
  assert.deepEqual(sent, [{
    note: { ...NOTE, story: "arc-surface", version: "0.3.99", at: "2026-10-21T12:00:00.000Z" },
    screenshot: undefined,
    crop: undefined,
    actor: "app:feedback-corner",
  }]);

  // Only a note's own fields are kept, whatever else the page sent; a missing selection or project is left out.
  await runtime.sendFeedback({ ...NOTE, surface: "menu:help", selection: undefined, project: undefined, extra: "dropped" } as never);
  assert.deepEqual(sent[1]!.note, { text: NOTE.text, surface: "menu:help", story: "app", anchor: ANCHOR, window: NOTE.window, theme: "dark", version: "0.3.99", at: "2026-10-21T12:00:00.000Z" });
  assert.deepEqual(opened, ["storytree"], "the library is opened once");

  await assert.rejects(runtime.sendFeedback({ ...NOTE, surface: "nowhere" }), /no declared surface "nowhere"/, "a surface no story declares is refused");
  await assert.rejects(runtime.sendFeedback({ ...NOTE, text: "   " }), /needs text/, "a note with no text is refused");
  await assert.rejects(runtime.sendFeedback({ ...NOTE, anchor: undefined } as never), /needs the element it is about/, "every note points at an element");
  await assert.rejects(runtime.sendFeedback({ ...NOTE, anchor: { ...ANCHOR, selector: "" } }), /selector and tag/);
  assert.equal(sent.length, 2, "a refused note writes nothing");
});

test("3.2 · the app window is captured before the composer opens and stored as a JPEG with the record, unless the owner drops it; the button is offered only where the library holds project storytree", async () => {
  const { given, sent } = frame(["storytree"]);
  const runtime = createFeedbackRuntime(given);
  const token = await runtime.captureForFeedback();
  assert.equal(typeof token, "string");
  await runtime.sendFeedback(NOTE, token);
  assert.deepEqual(sent[0]!.screenshot, JPEG, "the picture taken is the one stored with the note");
  await runtime.sendFeedback(NOTE, token);
  assert.equal(sent[1]!.screenshot, undefined, "a picture is stored with one note only");
  await runtime.captureForFeedback();
  await runtime.sendFeedback(NOTE);
  assert.equal(sent[2]!.screenshot, undefined, "a note sent without its token, the picture dropped, has none");

  const failing = createFeedbackRuntime(frame(["storytree"], async () => { throw new Error("no window"); }).given);
  assert.equal(await failing.captureForFeedback(), undefined, "a capture that fails takes no picture and does not stop the note");

  assert.equal((await createFeedbackRuntime(frame(["site"]).given).feedbackSetup()).offered, false, "a library without project storytree is not offered the corner");
  assert.equal((await createFeedbackRuntime({ ...frame([]).given, server: () => undefined }).feedbackSetup()).offered, false, "nor is a library not yet open");
  await assert.rejects(createFeedbackRuntime(frame(["site"]).given).sendFeedback(NOTE), /holds no project storytree/);

  const [part] = feedbackPageAnswers;
  assert.deepEqual(part!(given).channels, FEEDBACK_CHANNELS, "the manifest's part answers this story's channels");
});

test("3.3 · a picture cut to the element, widened by a margin, is captured once the element is picked and stored beside the window's picture; dropping the pictures drops both", async () => {
  const CROP = Uint8Array.from([0xff, 0xd8, 7, 0xff, 0xd9]);
  const rects: unknown[] = [];
  const { given, sent } = frame(["storytree"], async (rect) => { rects.push(rect); return rect === undefined ? JPEG : CROP; });
  const runtime = createFeedbackRuntime(given);
  const window = await runtime.captureForFeedback();
  const crop = await runtime.captureForFeedback({ x: 10.4, y: 30, width: 60, height: 24.2 });
  assert.deepEqual(rects, [undefined, { x: 0, y: 14, width: 87, height: 57 }], `the element's box and ${CROP_MARGIN}px round it, kept inside the window`);
  await runtime.sendFeedback(NOTE, window, crop);
  assert.deepEqual([sent[0]!.screenshot, sent[0]!.crop], [JPEG, CROP]);

  const again = [await runtime.captureForFeedback(), await runtime.captureForFeedback(ANCHOR.box)];
  await runtime.sendFeedback(NOTE, undefined, again[1]);
  assert.deepEqual([sent[1]!.screenshot, sent[1]!.crop], [undefined, undefined], "no crop without its window picture");
  await assert.rejects(runtime.captureForFeedback({ x: 1, y: 2 } as never), /needs the element's box/);
});

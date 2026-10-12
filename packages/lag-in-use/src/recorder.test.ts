import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGUE, type PageState } from "@storytree/forest/actions";

import type { LagReading } from "./bridge.js";
import { createRecorder } from "./recorder.js";

const closed: PageState = { selected: undefined, note: undefined, panelOpen: false, mode: "forest", sessionSelected: false, still: true, progress: false, startSettled: true };
const open = (story: string, extra: Partial<PageState> = {}): PageState => ({ ...closed, selected: story, panelOpen: true, ...extra });

/** A recorder whose batches land in `sent`; an island's size is its capability count from `sizes`. */
function recording(sizes: Record<string, number> = {}) {
  const sent: LagReading[][] = [];
  const recorder = createRecorder({ catalogue: CATALOGUE, send: async (batch) => { sent.push(batch); }, size: (story) => sizes[story] });
  return { sent, recorder };
}

test("1.1 · a catalogue action its user takes becomes one reading of its response, long frames, settled time, progress, name and size", () => {
  const { sent, recorder } = recording({ story_lib: 14 });

  // Opening the library's island: the panel opens at once with a loading circle, the globe glides and is still 350 ms after the click.
  recorder.input(1000, closed);
  recorder.observe({
    events: [{ start: 900, duration: 300 }, { start: 1000, duration: 136 }],
    frames: [{ start: 1020, duration: 80 }, { start: 1200, duration: 64 }, { start: 2000, duration: 400 }],
  });
  recorder.frame(1016, open("story_lib", { still: false, progress: true }));
  recorder.frame(1100, open("story_lib", { still: false }));
  recorder.frame(1350, open("story_lib"));
  // Event Timing reports after the paint: the reading is finished two frames after settled.
  recorder.frame(1366, open("story_lib"));
  recorder.frame(1383, open("story_lib"));

  // Closing the panel: nothing reached Event Timing's 16 ms, so the response reads 0; a panel has no size.
  recorder.input(5000, open("story_lib"));
  recorder.frame(5016, closed);
  recorder.frame(5033, closed);
  recorder.frame(5050, closed);

  // An input that settles no catalogue action within its limit (a click on empty sea) records nothing.
  recorder.input(9000, closed);
  recorder.frame(9016, closed);
  recorder.frame(9000 + 10_001, closed);

  // Once the page has answered an input (here, a loading circle), a second input belongs to the action under way: one reading,
  // timed from the first.
  recorder.input(30_000, open("story_lib"));
  recorder.frame(30_005, open("story_lib", { progress: true }));
  recorder.input(30_010, open("story_lib"));
  recorder.frame(30_016, open("story_two"));
  recorder.frame(30_033, open("story_two"));
  recorder.frame(30_050, open("story_two"));

  // An input the page shows no answer to (a drag that turns the globe) does not hold the next one's time: the click two seconds
  // later is timed from itself. Times are kept to the whole millisecond.
  recorder.input(40_000, closed);
  recorder.frame(40_016, { ...closed, still: false });
  recorder.input(42_000.4, closed);
  recorder.frame(42_120.7, open("story_lib"));
  recorder.frame(42_137, open("story_lib"));
  recorder.frame(42_153, open("story_lib"));

  recorder.flush();
  assert.deepEqual(sent, [[
    { name: "open-island", response: 136, longFrames: 2, longestFrame: 80, settled: 350, progress: true, size: 14 },
    { name: "close-panel", response: 0, longFrames: 0, longestFrame: 0, settled: 16, progress: false },
    { name: "open-island", response: 0, longFrames: 0, longestFrame: 0, settled: 16, progress: true },
    { name: "open-island", response: 0, longFrames: 0, longestFrame: 0, settled: 120, progress: false, size: 14 },
  ]]);
});

test("1.1 · a Library note and a session's row are recognised by what changed, and an action the field cannot tell is never guessed", () => {
  const { sent, recorder } = recording();
  const library: PageState = { ...closed, mode: "library" };
  // Switching to the Library is answered and done (the page is still) before the note is clicked: the note is timed from its click.
  recorder.input(20, closed);
  recorder.frame(36, library);
  recorder.input(100, library);
  recorder.frame(150, { ...library, note: "note_a", panelOpen: true });
  recorder.frame(166, { ...library, note: "note_a", panelOpen: true });
  recorder.frame(183, { ...library, note: "note_a", panelOpen: true });
  // Switching to the Library and back is two inputs the field cannot tell from other clicks: the catalogue gives it no field name.
  recorder.input(1000, closed);
  recorder.frame(1016, { ...closed, mode: "library" });
  recorder.frame(1000 + 10_001, { ...closed, mode: "library" });
  recorder.input(20_000, closed);
  recorder.frame(20_040, { ...closed, sessionSelected: true });
  recorder.frame(20_056, { ...closed, sessionSelected: true });
  recorder.frame(20_073, { ...closed, sessionSelected: true });
  recorder.flush();
  assert.deepEqual(sent.flat().map((reading) => [reading.name, reading.settled]), [["open-library-note", 50], ["open-session-row", 40]]);
});

test("1.2 · readings reach the app in batches, never between an action's input and its settling", () => {
  const { sent, recorder } = recording();
  recorder.flush();
  assert.equal(sent.length, 0, "nothing recorded, nothing sent");

  recorder.input(1000, open("story_a"));
  recorder.frame(1016, closed);
  recorder.frame(1033, closed);
  recorder.frame(1050, closed);
  recorder.input(2000, closed);
  recorder.frame(2016, open("story_a", { still: false }));
  assert.equal(recorder.pending, true);
  recorder.flush();
  assert.equal(sent.length, 0, "an action is under way: the reading already taken waits");
  recorder.frame(2100, open("story_a"));
  recorder.frame(2116, open("story_a"));
  assert.equal(recorder.pending, true, "settled, but its Event Timing entries are still to come");
  recorder.flush();
  assert.equal(sent.length, 0);
  recorder.frame(2133, open("story_a"));
  assert.equal(recorder.pending, false);
  assert.equal(sent.length, 1, "the flush asked for while the action was under way goes as soon as it ends");
  assert.deepEqual(sent[0]!.map((reading) => reading.name), ["close-panel", "open-island"]);
  recorder.flush();
  assert.equal(sent.length, 1, "none for an empty batch");

  // An input that settles nothing holds a flush only until its limit passes.
  recorder.input(3000, closed);
  recorder.frame(3016, closed);
  recorder.frame(3100, open("story_a"));
  recorder.frame(3116, open("story_a"));
  recorder.frame(3133, open("story_a"));
  recorder.input(20_000, closed);
  recorder.flush();
  assert.equal(sent.length, 1);
  recorder.frame(20_000 + 10_001, closed);
  assert.equal(sent.length, 2);
});

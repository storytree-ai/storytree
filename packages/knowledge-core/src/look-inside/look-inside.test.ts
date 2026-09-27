/** Capability 4 · Look inside and inspect a note (stories/knowledge-core.md). */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Agent, Line } from "@storytree/agent-link";

import { knowledge } from "../ghosts/ghosts.js";
import { ReadRecord, NO_RECORDED_READS } from "../reads/reads.js";
import { underShelves } from "../shelves/shelves.js";
import { History } from "../testing/changes.js";
import { coreScene, legend, noteCard, noteTitle, pinnedLinks, replayFrame, SIZE_LABELS, type CoreInput } from "./look-inside.js";
import { lookInside, returnToGlobe, shown, toForest, type CoreViewState } from "./view-state.js";

const RADIUS = 100;
const spots = new Map([["s", { x: 0, y: 0, z: 1 }], ["t", { x: 1, y: 0, z: 0 }]]);

let seq = 0;
const read = (session: string, note: string, how: "peek" | "whole", agent?: Agent): Line => ({
  seq: ++seq, project: "app", at: new Date(Date.UTC(2026, 8, 27, 0, 0, seq)).toISOString(), session, source: "tool", kind: "note-read",
  note, found: "search", read: how, ...(agent === undefined ? {} : { agent }),
});

function input(history: History, lines: Line[] = [], extra: Partial<CoreInput> = {}): CoreInput {
  const k = knowledge(history.changes);
  const reads = new ReadRecord("app");
  reads.add(lines);
  return { changes: history.changes, knowledge: k, core: underShelves(history.changes, k), reads, spots, radius: RADIUS, session: undefined, sizeBy: "visits", ...extra };
}

/** Two stories: s with a capability whose cover chains to a deep note, t with an old decision replaced. */
function project(): History {
  return new History()
    .story("s").capability("cap", "s").story("t")
    .memory("deep", { title: "Deep note" })
    .decision("cover", { frontCoverOf: "cap", links: ["deep", "old"], title: "The cover" })
    .decision("old", { frontCoverOf: "t" })
    .decision("new", { frontCoverOf: "t", supersedes: ["old"] })
    .memory("loose");
}

const length = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);

test("4.1 the core keeps each shelf's entrance, named, at its island's place, and a pinned note's card says all it knows", () => {
  const history = project();
  const lines = [read("s1", "deep", "whole", "orchestrator"), read("s2", "deep", "peek"), read("s1", "old", "peek", "orchestrator")];
  const scene = coreScene(input(history, lines));

  const entrance = scene.entrances.find(({ node }) => node === "t")!;
  assert.equal(entrance.title, "t");
  assert.deepEqual(entrance.at, { x: RADIUS, y: 0, z: 0 }, "a story's own shelf sits at its island's spot on the surface");
  const capEntrance = scene.entrances.find(({ node }) => node === "cap")!;
  assert.ok(Math.abs(length(capEntrance.at) - RADIUS) < 1e-9 && capEntrance.at.z > 0.9 * RADIUS, "a capability's shelf is on its story's island");
  const deep = scene.notes.find(({ id }) => id === "deep")!;
  const cover = scene.notes.find(({ id }) => id === "cover")!;
  assert.ok(length(deep.at) < length(cover.at) && length(cover.at) < RADIUS, "deeper hangs further inside");
  assert.ok(length(scene.notes.find(({ id }) => id === "loose")!.at) > RADIUS, "a note with no depth orbits outside");

  assert.deepEqual(noteCard("deep", input(history, lines)), {
    id: "deep", title: "Deep note", text: "deep's text", home: "cap", depth: "depth 2", entrances: ["cap"],
    replacement: undefined, visits: 2, peeks: 1, wholes: 1, linksToReplaced: [],
  });
  assert.equal(noteCard("loose", input(history))?.depth, "no depth");
  assert.equal(noteCard("old", input(history))?.replacement, "superseded by new");
  assert.deepEqual(noteCard("cover", input(history))?.linksToReplaced, ["old: superseded by new"], "a card says when it links to a ghost");
  assert.equal(noteCard("nothing", input(history)), undefined);

  const untitled = new History().memory("plain").update("plain", { title: undefined, text: "Round half to even, once, at the total.\nNever per line." });
  assert.equal(noteCard("plain", input(untitled))?.title, "Round half to even, once, at the total.", "a memory has no title field: its first line names it");
  assert.equal(noteTitle({ id: "d", type: "definition", version: 1, createdAt: "", updatedAt: "", fields: { term: "shelf", meaning: "an entrance" } }), "shelf");
});

test("4.2 links show only for the pinned note, in their stored direction both ways, and never as replay cues", () => {
  const history = project();
  assert.deepEqual(pinnedLinks(undefined, knowledge(history.changes)), []);
  assert.deepEqual(pinnedLinks("deep", knowledge(history.changes)), [{ kind: "link", from: "cover", to: "deep" }]);
  assert.deepEqual(pinnedLinks("cover", knowledge(history.changes)), [{ kind: "link", from: "cover", to: "deep" }, { kind: "link", from: "cover", to: "old" }]);
  const lines = [read("s1", "cover", "whole", "orchestrator"), read("s1", "deep", "whole", "orchestrator")];
  const { agents } = input(history, lines).reads.replay("s1", new Set(knowledge(history.changes).notes.keys()));
  const frame = replayFrame(agents, 2, new Set());
  assert.ok(frame.jumps.every(({ move }) => move === "jump"), "a replay cue is a jump, never a link");
});

test("4.3 an unreached note is grey whatever other sessions did, every note has a visible size, and the size toggle moves nothing", () => {
  const history = project();
  const lines = [read("s1", "deep", "whole", "orchestrator"), read("s2", "cover", "whole", "orchestrator")];
  const byVisits = coreScene(input(history, lines, { session: "s1" }));
  assert.equal(byVisits.notes.find(({ id }) => id === "cover")!.tone, "grey", "read in s2, not in the selected s1");
  assert.equal(byVisits.notes.find(({ id }) => id === "deep")!.tone, "reached");
  assert.ok(byVisits.notes.every(({ size }) => size >= 1), "zero visits still has the minimum size");
  assert.equal(byVisits.sizeLabel, SIZE_LABELS.visits);

  const byLinks = coreScene(input(history, lines, { session: "s1", sizeBy: "links-in" }));
  assert.equal(byLinks.sizeLabel, SIZE_LABELS["links-in"]);
  assert.match(SIZE_LABELS.visits, /sessions/);
  assert.match(SIZE_LABELS["links-in"], /link/);
  assert.deepEqual(byLinks.notes.map(({ id, at }) => [id, at]), byVisits.notes.map(({ id, at }) => [id, at]), "size, never place");
  assert.notDeepEqual(byLinks.notes.map(({ size }) => size), byVisits.notes.map(({ size }) => size));

  assert.equal(coreScene(input(history)).status, NO_RECORDED_READS);
});

test("4.4 replay steps one session's agents in order; each agent hides on its own; the legend invents no names or tasks", () => {
  const history = project();
  const helper: Agent = { subagent: "h1", type: "explorer" };
  const lines = [
    read("s1", "cover", "whole", "orchestrator"), read("s1", "deep", "whole", helper), read("s1", "loose", "peek", "orchestrator"),
    read("s1", "old", "whole", { subagent: "h2" }), read("s1", "new", "whole"),
  ];
  const present = new Set(knowledge(history.changes).notes.keys());
  const { agents } = input(history, lines).reads.replay("s1", present);

  assert.deepEqual([...replayFrame(agents, 0, new Set()).lit.keys()], [], "restart shows nothing lit");
  assert.deepEqual([...replayFrame(agents, 2, new Set()).lit], [["cover", "orchestrator"], ["deep", "subagent:h1"]]);
  const all = replayFrame(agents, Infinity, new Set());
  assert.equal(all.lit.size, 5);
  assert.equal(all.steps, 5);
  const hidden = replayFrame(agents, Infinity, new Set(["subagent:h1"]));
  assert.equal(hidden.lit.has("deep"), false);
  assert.ok(hidden.jumps.every(({ agent }) => agent !== "subagent:h1"));

  const key = legend(agents);
  assert.deepEqual(key.map(({ agent, label, task }) => [agent, label, task]), [
    ["orchestrator", "orchestrator", undefined], ["subagent:h1", "explorer", undefined], ["subagent:h2", "subagent h2", undefined], ["unknown", "unknown agent", undefined],
  ]);
  assert.equal(new Set(key.map(({ colour }) => colour)).size, 4, "each agent its own colour");
});

test("4.5 looking inside keeps failure attention and the flat forest one click away, and returning restores the globe and selection", () => {
  const globe: CoreViewState = { mode: "globe", selected: "failing-story", pinned: undefined };
  const inside = lookInside(globe);
  assert.equal(inside.mode, "inside");
  assert.deepEqual(shown(inside), { sea: false, islands: false, entrances: true, failureMarkers: true, forestButton: true, globeButton: true });
  assert.deepEqual(shown(globe), { sea: true, islands: true, entrances: false, failureMarkers: true, forestButton: true, globeButton: true });
  assert.equal(toForest(inside).mode, "forest", "the flat forest is one step from inside");
  const back = returnToGlobe({ ...inside, pinned: "deep" });
  assert.deepEqual(back, globe, "islands, sea and the selection come back; the pin is let go");
});

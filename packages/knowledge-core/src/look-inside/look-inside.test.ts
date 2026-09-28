/** Capability 4 · Look inside and inspect a note (the knowledge core story). */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Agent, Line } from "@storytree/agent-link";

import { knowledge } from "../ghosts/ghosts.js";
import { ReadRecord, NO_RECORDED_READS } from "../reads/reads.js";
import { underShelves } from "../shelves/shelves.js";
import { History } from "../testing/changes.js";
import { agentPaths, coreScene, curvePoint, glowAt, growthPlan, heldNotes, legend, lighting, noteCard, tailSpan, trails, noteTitle, pinnedLinks, replayFrame, SIZE_LABELS, type CoreInput } from "./look-inside.js";
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
    id: "deep", kind: "memory", title: "Deep note", summary: undefined, text: "deep's text", home: "cap", depth: "depth 2", entrances: ["cap"],
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

test("4.1 a card uses an artifact's description or summary fields and preserves whole text when there is no summary", () => {
  const history = new History()
    .memory("described", { title: "A short title", description: "The compact description.", text: "The longer explanation." })
    .decision("summarised", { summary: "The decision in one line.", text: "All the decision's details." })
    .create("defined", "definition", { term: "shelf", meaning: "An entrance to a story's knowledge." })
    .create("principle", "principle", { title: "Write minimally", statement: "Protect one missing behaviour.", why: "Longer reasoning." })
    .create("agent", "agent", { title: "Builder", oneLine: "Builds a green unit.", role: "The complete role." })
    .memory("whole", { description: "  ", text: "First paragraph.\n\nSecond paragraph, kept whole." });
  const model = input(history);

  assert.equal(noteCard("described", model)?.kind, "memory");
  assert.equal(noteCard("described", model)?.title, "A short title");
  assert.equal(noteCard("described", model)?.summary, "The compact description.");
  assert.equal(noteCard("summarised", model)?.summary, "The decision in one line.");
  assert.equal(noteCard("defined", model)?.summary, "An entrance to a story's knowledge.");
  assert.equal(noteCard("principle", model)?.summary, "Protect one missing behaviour.");
  assert.equal(noteCard("agent", model)?.summary, "Builds a green unit.");
  assert.equal(noteCard("whole", model)?.summary, undefined);
  assert.equal(noteCard("whole", model)?.text, "First paragraph.\n\nSecond paragraph, kept whole.");
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
  assert.match(SIZE_LABELS["links-in"], /the distinct artifacts linking to it/, "the records are artifacts (ADR-0650)");
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

test("4.7 with no session selected, every listed session lights what it read in its own colour, and a note two of them read is shared", () => {
  const history = project();
  const roster = [
    { session: "a", label: "Signup", colour: "hsl(200, 80%, 68%)", members: ["a", "a-child"] },
    { session: "b", label: "Billing", colour: "hsl(300, 80%, 68%)", members: ["b"] },
  ];
  const lines = [read("a", "deep", "whole", "orchestrator"), read("a-child", "new", "peek"), read("b", "cover", "whole", "orchestrator"),
    read("b", "deep", "peek", { subagent: "h1" }), read("z", "loose", "whole", "orchestrator")];
  const notes = new Map(coreScene(input(history, lines, { roster })).notes.map((note) => [note.id, note]));
  assert.deepEqual([notes.get("cover")!.tone, notes.get("cover")!.colour, notes.get("cover")!.shared], ["lit", "hsl(300, 80%, 68%)", false]);
  assert.deepEqual([notes.get("new")!.tone, notes.get("new")!.colour], ["lit", "hsl(200, 80%, 68%)"], "a child's reads wear its parent's colour");
  assert.equal(notes.get("deep")!.shared, true, "read by two listed sessions");
  assert.equal(notes.get("deep")!.colour, "hsl(300, 80%, 68%)", "a shared note wears its latest reader's colour");
  assert.equal(notes.get("loose")!.tone, "grey", "a session with no row lights nothing");
  assert.equal(notes.get("old")!.tone, "grey");

  const drilled = new Map(coreScene(input(history, lines, { roster, session: "b" })).notes.map((note) => [note.id, note]));
  assert.equal(drilled.get("new")!.tone, "grey", "a selection shows that session alone");
});

test("4.8 drilling into a listed session wears its colour: the orchestrator the session's own, each subagent a shade of its hue", () => {
  const history = project();
  const lines = [read("s1", "cover", "whole", "orchestrator"), read("s1", "deep", "whole", { subagent: "h1", type: "explorer" }),
    read("s1", "old", "whole", { subagent: "h2" }), read("s1", "new", "whole")];
  const present = new Set(knowledge(history.changes).notes.keys());
  const { agents } = input(history, lines).reads.replay("s1", present);
  const key = new Map(legend(agents, "hsl(200, 80%, 68%)").map(({ agent, colour }) => [agent, colour]));
  assert.equal(key.get("orchestrator"), "hsl(200, 80%, 68%)");
  const shades = [key.get("subagent:h1")!, key.get("subagent:h2")!];
  for (const shade of shades) assert.match(shade, /^hsl\(200, 80%, \d+%\)$/);
  assert.equal(new Set([key.get("orchestrator"), ...shades]).size, 3, "each agent still told apart");
  assert.equal(key.get("unknown"), legend(agents).find(({ agent }) => agent === "unknown")!.colour, "unknown stays pale");
});

test("4.9 the globe's dots light as the core does: every listed session with none selected, one session in its shades when selected", () => {
  const history = project();
  const roster = [
    { session: "a", label: "Signup", colour: "hsl(200, 80%, 68%)", members: ["a"] },
    { session: "b", label: "Billing", colour: "hsl(300, 80%, 68%)", members: ["b"] },
  ];
  const lines = [read("a", "deep", "whole", "orchestrator"), read("b", "cover", "whole", "orchestrator"),
    read("b", "deep", "whole", { subagent: "h1" }), read("z", "loose", "whole", "orchestrator")];
  const { reads, knowledge: known } = input(history, lines);
  const present = new Set(known.notes.keys());
  const all = lighting(reads, roster, undefined, present);
  assert.deepEqual([...all].sort(), [["cover", { colour: "hsl(300, 80%, 68%)", shared: false }], ["deep", { colour: "hsl(300, 80%, 68%)", shared: true }]]);
  const one = lighting(reads, roster, "b", present);
  assert.equal(one.get("cover")!.colour, "hsl(300, 80%, 68%)", "b's orchestrator wears b's colour");
  assert.match(one.get("deep")!.colour, /^hsl\(300, 80%, \d+%\)$/);
  assert.notEqual(one.get("deep")!.colour, "hsl(300, 80%, 68%)", "its subagent a shade");
  assert.equal(one.size, 2, "another session's reads stay faint");
  assert.equal(lighting(reads, [], undefined, present).size, 0, "no running sessions light nothing");
});

test("4.10 each session's reading path runs from one full read to that agent's next, in its colour; peeks, unknown agents and unlisted sessions draw none", () => {
  const history = project();
  const roster = [
    { session: "a", label: "Signup", colour: "hsl(200, 80%, 68%)", members: ["a"] },
    { session: "b", label: "Billing", colour: "hsl(300, 80%, 68%)", members: ["b"] },
  ];
  const lines = [read("a", "deep", "whole", "orchestrator"), read("a", "cover", "whole", "orchestrator"), read("a", "loose", "peek", "orchestrator"),
    read("a", "new", "whole", "orchestrator"), read("a", "old", "whole"), read("a", "deep", "whole"),
    read("b", "cover", "whole", { subagent: "h1" }), read("b", "deep", "whole", { subagent: "h1" }),
    read("z", "deep", "whole", "orchestrator"), read("z", "cover", "whole", "orchestrator")];
  const { reads, knowledge: known } = input(history, lines);
  const present = new Set(known.notes.keys());
  const all = trails(reads, roster, undefined, present).map(({ from, to, colour }) => [from, to, colour]);
  assert.deepEqual(all, [
    ["deep", "cover", "hsl(200, 80%, 68%)"], ["cover", "new", "hsl(200, 80%, 68%)"], ["cover", "deep", "hsl(300, 80%, 68%)"],
  ], "in reading order, from the earlier read to the later; a peek is skipped");
  const one = trails(reads, roster, "b", present);
  assert.deepEqual(one.map(({ from, to }) => [from, to]), [["cover", "deep"]], "a selection draws that session alone");
  assert.match(one[0]!.colour, /^hsl\(300, 80%, \d+%\)$/);
  assert.notEqual(one[0]!.colour, "hsl(300, 80%, 68%)", "a subagent's path wears its shade");
  assert.deepEqual(trails(reads, [], undefined, present), [], "no running sessions draw no paths");
});

test("4.11 each known agent's path ends at its latest full read and carries its reading steps in order; unknown agents and unlisted sessions have none", () => {
  const history = project();
  const roster = [
    { session: "a", label: "Signup", colour: "hsl(200, 80%, 68%)", members: ["a"] },
    { session: "b", label: "Billing", colour: "hsl(300, 80%, 68%)", members: ["b"] },
  ];
  const lines = [read("a", "deep", "whole", "orchestrator"), read("a", "cover", "whole", "orchestrator"), read("a", "loose", "peek", "orchestrator"),
    read("a", "new", "whole", { subagent: "h1" }), read("a", "old", "whole"),
    read("b", "cover", "whole", { subagent: "h2" }), read("b", "deep", "whole", { subagent: "h2" }), read("z", "deep", "whole", "orchestrator")];
  const { reads, knowledge: known } = input(history, lines);
  const present = new Set(known.notes.keys());
  const all = agentPaths(reads, roster, undefined, present).map(({ mover, colour, note, steps }) => [mover, colour, note, steps.map(({ from, to }) => `${from}>${to}`)]);
  assert.deepEqual(all, [
    ["a orchestrator", "hsl(200, 80%, 68%)", "cover", ["deep>cover"]],
    ["a subagent:h1", "hsl(200, 80%, 68%)", "new", []],
    ["b subagent:h2", "hsl(300, 80%, 68%)", "deep", ["cover>deep"]],
  ], "a peek adds no step; an unknown agent and an unlisted session have none");
  const one = agentPaths(reads, roster, "b", present);
  assert.deepEqual(one.map(({ mover }) => mover), ["b subagent:h2"], "a selection replays that session's paths alone");
  assert.notEqual(one[0]!.colour, "hsl(300, 80%, 68%)", "a subagent's path wears its shade");
  assert.deepEqual(agentPaths(reads, [], undefined, present), []);
});

test("4.12 a glow travels the step's own curve, bowed away from the centre, bright at its head and trailing back toward where it came from", () => {
  const from = { x: 50, y: 0, z: 0 }, to = { x: 0, y: 50, z: 0 };
  assert.deepEqual(curvePoint(from, to, 0), from);
  assert.deepEqual(curvePoint(from, to, 1), to);
  const middle = curvePoint(from, to, 0.5);
  assert.ok(Math.hypot(middle.x, middle.y, middle.z) > Math.hypot(25, 25), "bowed outward, never along the straight chord");
  const [start, end] = tailSpan(0.6);
  assert.equal(end, 0.6, "the glow's tail ends at its head");
  assert.ok(start < end && start >= 0, "and reaches back along the path it came by");
  assert.deepEqual(tailSpan(0.1), [0, 0.1], "never behind the step's own start");
  const [, arrived] = tailSpan(1);
  assert.equal(arrived, 1);
});

test("4.13 an agent's glow replays its steps in recorded order, one after another, pauses after the last, then loops", () => {
  const timing = { step: 1000, pause: 500 };
  assert.deepEqual(glowAt(3, 0, timing), { step: 0, t: 0 });
  assert.deepEqual(glowAt(3, 1500, timing), { step: 1, t: 0.5 });
  assert.deepEqual(glowAt(3, 2999, timing), { step: 2, t: 0.999 });
  assert.equal(glowAt(3, 3200, timing), undefined, "a pause after the last step");
  assert.deepEqual(glowAt(3, 3600, timing), { step: 0, t: 0.1 }, "then from the first again");
  assert.equal(glowAt(0, 100, timing), undefined, "a path with no steps never glows");
});

test("4.14 new steps grow one after another per agent, in recorded order; different agents grow at once, and history grows nothing", () => {
  const busy = new Map([["a orchestrator", 1500]]);
  const fresh = [
    { key: "a1", mover: "a orchestrator", seq: 5 }, { key: "b1", mover: "b orchestrator", seq: 6 }, { key: "a2", mover: "a orchestrator", seq: 7 },
  ];
  const plan = growthPlan(fresh, busy, 1000, 800);
  assert.deepEqual([...plan.starts], [["a1", 1500], ["b1", 1000], ["a2", 2300]], "a waits for its step in flight; b starts now");
  assert.deepEqual([...plan.busy].sort(), [["a orchestrator", 3100], ["b orchestrator", 1800]]);
  assert.deepEqual([...growthPlan([], busy, 1000, 800).starts], []);
});

test("4.15 a newly read note stays unlit until the growing line into it arrives; history and notes already lit are never held", () => {
  const steps = [{ to: "b", key: "a>b" }, { to: "c", key: "b>c" }, { to: "y", key: "x>y" }];
  const starts = new Map([["a>b", 1000], ["b>c", 1900]]);
  const grow = 900;
  assert.deepEqual([...heldNotes(steps, starts, 1500, grow, new Set())].sort(), ["b", "c"], "b's line is growing, c's is queued behind it");
  assert.deepEqual([...heldNotes(steps, starts, 2000, grow, new Set())], ["c"], "b lights the moment its line arrives");
  assert.deepEqual([...heldNotes(steps, starts, 1500, grow, new Set(["c"]))], ["b"], "a note already lit stays lit");
  assert.deepEqual([...heldNotes(steps, starts, 3000, grow, new Set())], [], "every line has arrived");
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

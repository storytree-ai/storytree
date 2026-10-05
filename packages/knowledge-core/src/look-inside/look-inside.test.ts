/** Capability 4 · Look inside and inspect a note (the knowledge core story): the card, and how the sessions' reads light and cross the globe. */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Agent, Line } from "@storytree/agent-link";

import { knowledge } from "../ghosts/ghosts.js";
import { ReadRecord } from "../reads/reads.js";
import { History } from "../testing/changes.js";
import { DOT_CEILING, DOT_FLOOR, codeKey, curvePoint, dotSizes, fillAt, hopPoint, growthPlan, heldNotes, legend, lighting, noteCard, trails, replayAt, ringArcs, traversalTrails, windowView, type CodePlaces } from "./look-inside.js";

let seq = 0;
const read = (session: string, note: string, how: "peek" | "whole", agent?: Agent): Line => ({
  seq: ++seq, project: "app", at: new Date(Date.UTC(2026, 8, 27, 0, 0, seq)).toISOString(), session, source: "tool", kind: "note-read",
  note, found: "search", read: how, ...(agent === undefined ? {} : { agent }),
});

function input(history: History, lines: Line[] = []): { reads: ReadRecord; knowledge: ReturnType<typeof knowledge> } {
  const reads = new ReadRecord("app");
  reads.add(lines);
  return { knowledge: knowledge(history.changes), reads };
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

test("4.1 a card uses an artifact's description or summary fields and preserves whole text when there is no summary", () => {
  const history = new History()
    .memory("described", { title: "A short title", description: "The compact description.", text: "The longer explanation." })
    .decision("summarised", { summary: "The decision in one line.", text: "All the decision's details." })
    .create("defined", "definition", { term: "shelf", meaning: "An entrance to a story's knowledge." })
    .create("principle", "principle", { title: "Write minimally", statement: "Protect one missing behaviour.", why: "Longer reasoning." })
    .create("agent", "agent", { title: "Builder", oneLine: "Builds a green unit.", role: "The complete role." })
    .memory("whole", { description: "  ", text: "First paragraph.\n\nSecond paragraph, kept whole." });
  const model = knowledge(history.changes);

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

test("4.7 with no session selected, no session lights a note, though the listed sessions have read them; selecting one lights what it read", () => {
  const history = project();
  const roster = [
    { session: "a", label: "Signup", colour: "hsl(200, 80%, 68%)", members: ["a", "a-child"] },
    { session: "b", label: "Billing", colour: "hsl(300, 80%, 68%)", members: ["b"] },
  ];
  const lines = [read("a", "deep", "whole", "orchestrator"), read("a-child", "new", "peek"), read("b", "cover", "whole", "orchestrator")];
  const { reads, knowledge: known } = input(history, lines);
  const present = new Set(known.notes.keys());
  assert.equal(lighting(reads, roster, undefined, present).size, 0, "none selected lights nothing");
  assert.deepEqual([...lighting(reads, roster, "b", present).keys()], ["cover"], "a selection lights that session's reads alone");
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

test("4.9 the globe's dots light as the core does: nothing with none selected, one session in its shades when selected, a note both read showing that session alone", () => {
  const history = project();
  const roster = [
    { session: "a", label: "Signup", colour: "hsl(200, 80%, 68%)", members: ["a"] },
    { session: "b", label: "Billing", colour: "hsl(300, 80%, 68%)", members: ["b"] },
  ];
  const lines = [read("a", "deep", "whole", "orchestrator"), read("b", "cover", "whole", "orchestrator"),
    read("b", "deep", "whole", { subagent: "h1" }), read("z", "loose", "whole", "orchestrator")];
  const { reads, knowledge: known } = input(history, lines);
  const present = new Set(known.notes.keys());
  assert.equal(lighting(reads, roster, undefined, present).size, 0, "with none selected nothing lights");
  const one = lighting(reads, roster, "b", present);
  assert.equal(one.get("cover")!.colour, "hsl(300, 80%, 68%)", "b's orchestrator wears b's colour");
  assert.match(one.get("deep")!.colour, /^hsl\(300, 80%, \d+%\)$/);
  assert.notEqual(one.get("deep")!.colour, "hsl(300, 80%, 68%)", "its subagent a shade");
  assert.equal(one.size, 2, "another session's reads stay faint");
  assert.deepEqual(one.get("deep")!.readers.map(({ colour }) => colour), [one.get("deep")!.colour], "a note both read wears the selected session's colour alone");
  assert.deepEqual(ringArcs(one.get("deep")!), [], "with no ring for the other session");
});

test("4.10 a selected session's reading path runs from one full read to that agent's next, in its colour; with none selected no path draws, and peeks and unknown agents draw none", () => {
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
  assert.deepEqual(trails(reads, roster, undefined, present), [], "with none selected no path draws");
  assert.deepEqual(trails(reads, roster, "a", present).map(({ from, to }) => [from, to]), [["deep", "cover"], ["cover", "new"]],
    "in reading order, from the earlier read to the later; a peek and an unknown agent are skipped");
  const one = trails(reads, roster, "b", present);
  assert.deepEqual(one.map(({ from, to }) => [from, to]), [["cover", "deep"]], "a selection draws that session alone");
  assert.match(one[0]!.colour, /^hsl\(300, 80%, \d+%\)$/);
  assert.notEqual(one[0]!.colour, "hsl(300, 80%, 68%)", "a subagent's path wears its shade");
});

test("4.12 in a selected session's replay, a subagent's first read steps from the session's latest full read before it, so the head carries on from where it was spawned", () => {
  const history = project();
  const roster = [{ session: "b", label: "Billing", colour: "hsl(300, 80%, 68%)", members: ["b"] }];
  const lines = [read("b", "cover", "whole", "orchestrator"), read("b", "old", "peek", "orchestrator"), read("b", "new", "whole", "orchestrator"),
    read("b", "deep", "whole", { subagent: "h1" }), read("b", "loose", "whole", { subagent: "h1" }), read("b", "cover", "whole", "orchestrator")];
  const { reads, knowledge: known } = input(history, lines);
  const selected = trails(reads, roster, "b", new Set(known.notes.keys()));
  assert.deepEqual(selected.map(({ from, to, mover }) => `${from}>${to} ${mover.split(" ")[1]}`),
    ["cover>new orchestrator", "new>deep subagent:h1", "deep>loose subagent:h1", "new>cover orchestrator"],
    "the subagent's first step leaves the orchestrator's latest full read before it; a peek is no spawn point");
  assert.deepEqual(replayAt(selected, 1500, { step: 1000, rest: 0 }).head?.step.to, "deep", "the head walks it in its place");
});

test("4.10 a reading path's step is a curve bowed away from the centre, from its earlier read to its later one", () => {
  const from = { x: 50, y: 0, z: 0 }, to = { x: 0, y: 50, z: 0 };
  assert.deepEqual(curvePoint(from, to, 0), from);
  assert.deepEqual(curvePoint(from, to, 1), to);
  const middle = curvePoint(from, to, 0.5);
  assert.ok(Math.hypot(middle.x, middle.y, middle.z) > Math.hypot(25, 25), "bowed outward, never along the straight chord");
});

test("4.12 a selected session replays as one head walking every agent's steps in recorded order, building the picture, then rests and starts again", () => {
  const step = (from: string, to: string, seq: number, mover: string) => ({ from, to, seq, mover, colour: mover });
  // Two agents, interleaved as the transcript was: the head follows seq across them, not each agent on its own.
  const steps = [step("a", "b", 1, "orchestrator"), step("b", "c", 4, "orchestrator"), step("x", "y", 2, "explorer"), step("y", "z", 3, "explorer")];
  const timing = { step: 1000, rest: 2000 };
  const at = (elapsed: number) => {
    const moment = replayAt(steps, elapsed, timing);
    return { drawn: moment.drawn.map(({ from, to }) => `${from}>${to}`), head: moment.head && `${moment.head.step.from}>${moment.head.step.to} ${moment.head.t}`,
      lit: [...moment.lit].sort(), over: moment.over };
  };
  assert.deepEqual(at(0), { drawn: [], head: "a>b 0", lit: ["a"], over: false }, "only the first read, its line just starting");
  assert.deepEqual(at(1500), { drawn: ["a>b"], head: "x>y 0.5", lit: ["a", "b", "x"], over: false }, "the explorer's step comes next, by seq");
  assert.deepEqual(at(3250), { drawn: ["a>b", "x>y", "y>z"], head: "b>c 0.25", lit: ["a", "b", "x", "y", "z"], over: false });
  assert.deepEqual(at(5000), { drawn: ["a>b", "x>y", "y>z", "b>c"], head: undefined, lit: ["a", "b", "c", "x", "y", "z"], over: false }, "the finished picture holds");
  assert.equal(replayAt(steps, 6000, timing).over, true, "after its rest the replay is over, to start again from nothing");
  // A live read arriving mid-replay joins the end of the sequence, never growing on its own clock.
  const joined = replayAt([...steps, step("z", "q", 9, "explorer")], 4500, timing);
  assert.equal(`${joined.head?.step.from}>${joined.head?.step.to}`, "z>q");
  assert.equal(joined.drawn.length, 4);
  assert.deepEqual(replayAt([], 0, timing), { drawn: [], head: undefined, lit: new Set(), over: true });
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

test("4.16 a selected session's window draws one step per move in reading order, solid where a stored link joins the notes and dotted where none does; a compacted read fades with its steps, and a glimpsed note is tinted with no line", () => {
  const open = (id: string, resident = true, kind: "note" | "file" = "note") => ({ kind, id, call: `open ${id}`, tool: "mcp__storytree__open", resident });
  const links = new Set(["old>linked", "deep>last"]);
  const joined = (a: string, b: string) => links.has(`${a}>${b}`) || links.has(`${b}>${a}`);
  const view = windowView({
    session: "S", at: "-", compactions: 1, inView: [], glimpses: ["hit", "gone-from-the-library"],
    opens: [
      // Opened before the compaction: its read left the window.
      open("old", false),
      open("linked"),
      // A file read between two notes does not break the chain; files are not drawn on the globe.
      open("src/claims/merges.ts", true, "file"),
      open("deep"),
      open("gone-from-the-library"),
      open("last"),
      open("deep"),
      open("last"),
    ],
  }, new Set(["old", "linked", "deep", "last", "hit"]), joined);

  assert.deepEqual(view.steps, [
    { from: "old", to: "linked", edge: "solid", faded: true },
    { from: "linked", to: "deep", edge: "dotted", faded: false },
    { from: "deep", to: "last", edge: "solid", faded: false },
    { from: "last", to: "deep", edge: "solid", faded: false },
  ], "a step taken twice draws once, and a note gone from the library is stepped over");
  assert.deepEqual([...view.notes], ["linked", "deep", "last"]);
  assert.deepEqual([...view.faded], ["old"]);
  assert.deepEqual([...view.glimpsed], ["hit"]);
  assert.deepEqual(view.files, ["src/claims/merges.ts"]);
  assert.equal(view.status, undefined);

  const none = windowView({ session: "S", at: "-", absent: "no hook has named this session's transcript" }, new Set(), joined);
  assert.deepEqual(none, { notes: new Set(), faded: new Set(), glimpsed: new Set(), files: [], steps: [], code: { files: new Map(), capabilities: new Map() }, status: "No window: no hook has named this session's transcript" });

  // Direction: a faint fill runs along each step from its earlier note to its later one, rests, then runs again.
  const timing = { run: 1000, pause: 500 };
  assert.deepEqual([0, 250, 999, 1200, 1750].map((ms) => fillAt(ms, timing)), [0, 0.25, 0.999, undefined, 0.25]);
});

/** Two files of the agent link (b imports a), a third that imports nothing, one of the forest's, and a capability with land. */
const SURFACE = 100;
const places: CodePlaces = {
  files: new Map([
    ["packages/agent-link/src/a.ts", { x: SURFACE, y: 0, z: 0 }],
    ["packages/agent-link/src/b.ts", { x: 0, y: SURFACE, z: 0 }],
    ["packages/agent-link/src/c.ts", { x: 0, y: 0, z: SURFACE }],
    ["packages/forest/src/f.ts", { x: -SURFACE, y: 0, z: 0 }],
  ]),
  imports: [{ from: "packages/agent-link/src/b.ts", to: "packages/agent-link/src/a.ts" }],
  capabilities: new Set(["cap-land"]),
};
const opened = (id: string, resident = true, kind: "note" | "file" = "note") => ({ kind, id, call: `open ${id}`, tool: "Read", resident });
const windowOf = (opens: ReturnType<typeof opened>[]) => ({ session: "S", at: "-", compactions: 0, inView: [], glimpses: [], opens });
const notJoined = () => false;

test("4.20 a file path names a surveyed file by the package and src path it ends in, absolute, relative or from a worktree; anything else names none", () => {
  assert.equal(codeKey("/home/me/code/storytree03/packages/agent-link/src/a.ts"), "packages/agent-link/src/a.ts");
  assert.equal(codeKey("/home/me/code/storytree03/.claude/worktrees/increment-1/packages/agent-link/src/x/y.ts"), "packages/agent-link/src/x/y.ts");
  assert.equal(codeKey("packages/agent-link/src/a.ts"), "packages/agent-link/src/a.ts");
  assert.equal(codeKey("C:\\code\\storytree03\\packages\\forest\\src\\f.ts"), "packages/forest/src/f.ts");
  for (const path of ["src/a.ts", "/etc/hosts", "/home/me/code/storytree03/scripts/gate.mjs", "/home/me/code/storytree03/packages/forest/package.json", "apps/desktop/src/main.ts"]) assert.equal(codeKey(path), undefined, path);
});

test("4.20 a window with two files, one importing the other, yields one solid file-to-file step; two with no import between them, a dotted one", () => {
  const view = windowView(windowOf([
    opened("/repo/packages/agent-link/src/a.ts", true, "file"),
    opened("/repo/packages/agent-link/src/b.ts", true, "file"),
    opened("packages/agent-link/src/c.ts", true, "file"),
  ]), new Set(), notJoined, places);
  assert.deepEqual(view.steps, [
    { from: "file:packages/agent-link/src/a.ts", to: "file:packages/agent-link/src/b.ts", edge: "solid", faded: false, kind: "hop" },
    { from: "file:packages/agent-link/src/b.ts", to: "file:packages/agent-link/src/c.ts", edge: "dotted", faded: false, kind: "hop" },
  ], "an import counts whichever way round the session read the two");
  assert.deepEqual([...view.code.files], [["packages/agent-link/src/a.ts", "in-window"], ["packages/agent-link/src/b.ts", "in-window"], ["packages/agent-link/src/c.ts", "in-window"]]);
  const across = windowView(windowOf([opened("/repo/packages/agent-link/src/a.ts", true, "file"), opened("/repo/packages/forest/src/f.ts", true, "file")]), new Set(), notJoined, places);
  assert.deepEqual(across.steps.map(({ edge, kind }) => [edge, kind]), [["dotted", "hop"]], "a hop to another island is a jump");
});

test("4.20 a file then a note yields a dive step, a note then a file a rise, and a file between two notes no longer joins them past the surface", () => {
  const present = new Set(["deep", "cover"]);
  const joined = (a: string, b: string) => a === "deep" && b === "cover";
  const view = windowView(windowOf([opened("deep"), opened("/repo/packages/agent-link/src/a.ts", true, "file"), opened("cover")]), present, joined, places);
  assert.deepEqual(view.steps, [
    { from: "deep", to: "file:packages/agent-link/src/a.ts", edge: "dotted", faded: false, kind: "dive" },
    { from: "file:packages/agent-link/src/a.ts", to: "cover", edge: "dotted", faded: false, kind: "dive" },
  ]);
  const plain = windowView(windowOf([opened("deep"), opened("/repo/packages/agent-link/src/a.ts", true, "file"), opened("cover")]), present, joined);
  assert.deepEqual(plain.steps.map(({ from, to }) => [from, to]), [["deep", "cover"]], "with no places given, files still never break the chain");
});

test("4.20 opening a capability marks its territory and breaks no chain; an arc, an increment or a contract is drawn nowhere; a path that names no surveyed file is stepped over", () => {
  const view = windowView(windowOf([
    opened("/repo/packages/agent-link/src/a.ts", true, "file"),
    opened("cap-land"),
    opened("arc_f59eb2a8e34d"),
    opened("increment_d02249eaf5a4"),
    opened("contract_a47660471f08"),
    opened("/repo/packages/agent-link/src/not-surveyed.ts", true, "file"),
    opened("/repo/scripts/gate.mjs", true, "file"),
    opened("/repo/packages/agent-link/src/c.ts", true, "file"),
  ]), new Set(), notJoined, places);
  assert.deepEqual([...view.code.capabilities], [["cap-land", "in-window"]]);
  assert.deepEqual(view.steps.map(({ from, to }) => [from, to]), [["file:packages/agent-link/src/a.ts", "file:packages/agent-link/src/c.ts"]]);
  assert.deepEqual([...view.code.files.keys()], ["packages/agent-link/src/a.ts", "packages/agent-link/src/c.ts"]);
  assert.equal(view.notes.size + view.faded.size + view.glimpsed.size, 0);

  const plan = windowView(windowOf([opened("arc_f59eb2a8e34d"), opened("increment_d02249eaf5a4")]), new Set(), notJoined, places);
  assert.deepEqual([plan.steps, [...plan.code.files], [...plan.code.capabilities], [...plan.notes]], [[], [], [], []]);
});

test("4.20 a file read compacted out of the window is lighter, and the steps it touches fade with it", () => {
  const view = windowView(windowOf([
    opened("/repo/packages/agent-link/src/a.ts", false, "file"),
    opened("/repo/packages/agent-link/src/b.ts", true, "file"),
    opened("cap-land", false),
  ]), new Set(), notJoined, places);
  assert.deepEqual([...view.code.files], [["packages/agent-link/src/a.ts", "faded"], ["packages/agent-link/src/b.ts", "in-window"]]);
  assert.deepEqual([...view.code.capabilities], [["cap-land", "faded"]]);
  assert.equal(view.steps[0]!.faded, true);
  const again = windowView(windowOf([opened("/repo/packages/agent-link/src/a.ts", false, "file"), opened("/repo/packages/agent-link/src/a.ts", true, "file")]), new Set(), notJoined, places);
  assert.equal(again.code.files.get("packages/agent-link/src/a.ts"), "in-window", "read again since, it is in the window now");
});

test("4.20 the traversal's trails carry what a step crosses; a hop arcs above the surface between two circles and a dive goes down through it into the core", () => {
  const view = windowView(windowOf([opened("/repo/packages/agent-link/src/a.ts", true, "file"), opened("/repo/packages/agent-link/src/c.ts", true, "file"), opened("deep")]), new Set(["deep"]), notJoined, places);
  const drawn = traversalTrails(view.steps, "#e69f00", "S");
  assert.deepEqual(drawn.map(({ from, to, seq, colour, mover, step }) => [from, to, seq, colour, mover, step]), [
    ["file:packages/agent-link/src/a.ts", "file:packages/agent-link/src/c.ts", 0, "#e69f00", "S", { edge: "dotted", faded: false, kind: "hop" }],
    ["file:packages/agent-link/src/c.ts", "deep", 1, "#e69f00", "S", { edge: "dotted", faded: false, kind: "dive" }],
  ]);
  const radius = ({ x, y, z }: { x: number; y: number; z: number }) => Math.hypot(x, y, z);
  const [a, c] = [places.files.get("packages/agent-link/src/a.ts")!, places.files.get("packages/agent-link/src/c.ts")!];
  const hop = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((t) => radius(hopPoint(a, c, t)));
  assert.deepEqual([hopPoint(a, c, 0), hopPoint(a, c, 1)], [a, c], "it leaves one circle and lands on the other");
  assert.ok(hop.every((r) => r >= SURFACE - 1e-9), "a hop never sinks below the surface it hops across, even a quarter of the way round the globe");
  assert.ok(Math.max(...hop) <= SURFACE * 1.12 + 1e-9 && hop[3]! > SURFACE, "and arcs just above it");
  const near = { x: SURFACE * Math.cos(0.05), y: 0, z: SURFACE * Math.sin(0.05) };
  assert.ok(radius(hopPoint(a, near, 0.5)) > SURFACE * 1.005, "even a short hop between two circles on one island lifts visibly");
  const core = { x: 0, y: 0, z: SURFACE * 0.4 };
  const dive = [0, 0.5, 1].map((t) => radius(curvePoint(places.files.get("packages/agent-link/src/a.ts")!, core, t)));
  assert.ok(dive[0]! >= SURFACE - 1e-9 && dive[2]! < SURFACE && dive[1]! < SURFACE, "a dive leaves the surface and ends inside the core");
});


test("4.21 each knowledge dot is sized by its note's reach: an unread note at the floor, the most-read at the ceiling, area growing linearly between", () => {
  const sizes = dotSizes(new Map([["top", 4], ["half", 2], ["peeked", 0.3], ["elsewhere", 9]]), ["top", "half", "peeked", "unread"]);
  assert.equal(sizes.get("unread"), DOT_FLOOR, "an unread note stays a visible dot");
  assert.equal(sizes.get("top"), DOT_CEILING, "the most-read drawn note sits at the ceiling, whatever an undrawn note's reach");
  const area = (note: string) => sizes.get(note)! ** 2 - DOT_FLOOR ** 2;
  assert.ok(Math.abs(area("half") - area("top") / 2) < 1e-12, "half the reach, half the area above the floor");
  assert.ok(sizes.get("peeked")! > DOT_FLOOR && sizes.get("peeked")! < sizes.get("half")!);
  assert.ok(DOT_FLOOR > 0 && DOT_CEILING > DOT_FLOOR);
  assert.deepEqual([...dotSizes(new Map(), ["a", "b"]).values()], [DOT_FLOOR, DOT_FLOOR], "with no recorded reads every dot rests at the floor");
});

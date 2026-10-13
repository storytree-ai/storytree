/** Capability 2 · The forest on the site. */
import type { GlobeSurfaces, GlobeSwitches, GlobeTarget, IslandBox } from "@storytree/forest/view";

/** "map" is Act 2's first chapter, taught on the shop (ADR-0891); "knowledge" follows it, on the same globe. */
export type Explainer = "map" | "knowledge";
export type Group = "opening" | Explainer | "ending";
/** Why the tour is waiting: the visitor's pause, a step's depth being read, every surface shown, or the globe being explored. */
export type Hold = "paused" | "reading" | "everything" | "exploring";
export type Decision = { number: number; title: string };
export type Source = { name: string; url: string };
export type Chip = { kind: "principle" | "partial" | "recording"; text: string };
/**
 * A label on the thing a line talks about (ADR-0891, amended 2026-10-10): fixed words, or words read from the record the globe
 * shows at that moment: a file's name and lines (after `text`, when it has one), the name of the session whose flag stands in a capability, or a story's health.
 * `narrowest` is the narrowest screen, in CSS pixels, it shows on: below that it would crowd the island or another name, and a
 * phone shows at most one in a step. A `point` names a panel to point out instead: the sessions list, outlined, the arcs
 * list's first arc, outlined and named in `text`, or the story panel's diagram, outlined and named in `text`.
 */
export type Label = { target: GlobeTarget; text?: string; read?: "file" | "holder" | "health"; narrowest?: number } | { point: "sessions" } | { point: "arc" | "panel"; text: string };
/** Another company's published mark, shown unaltered beside its name as a plain "works with" reference. */
export type Mark = { name: string; src: string };
export type TourStep = {
  id: string; explainer: Group; title: string;
  /** beats replace one another; lines accumulate; a comparison's lines each carry a source; a statement is a headline and
   * its subhead, alone; fixes pair each pain (its note) with its fix (its line). */
  kind?: "beats" | "lines" | "compare" | "statement" | "fixes";
  /** The step's layout (ADR-1018 D2): a statement, one claim alone; a claim beside the stage, with at most one support
   * beneath it; or a narrated stage, one sentence of caption at a time beside the globe. */
  template?: "statement" | "claim" | "narrated";
  lines: string[];
  /** Moments within the lines, each in seconds at 1× from the step's start: a label, a surface or a panel can arrive partway
   * through a line, as the map shows what the line would otherwise say. Where a step has cues, every number below keyed by
   * line (and a beat's line) counts its moments instead: its lines and its cues, in the order they begin. */
  cues?: readonly number[];
  notes?: string[]; sources?: (Source | undefined)[];
  /** A step's depth: how it works and why it exists, as curated explainers (ADR-0891); a comparison offered there. */
  how?: string; why?: string; decisions: Decision[]; chips?: Chip[];
  compare?: { lines: string[]; sources: (Source | undefined)[] };
  surfaces: Partial<GlobeSurfaces>;
  /** From the given line (1-based) on, these surfaces replace the step's own. */
  lineSurfaces?: Record<number, Partial<GlobeSurfaces>>;
  /** From the given line (1-based) on, this view replaces the step's own: the camera moves on the line that says why, and a
   * panel can give way to another as the line that names it is said. */
  lineViews?: Record<number, Pick<TourStep, "target" | "framing" | "laptop" | "phone" | "panel">>;
  /** The globe a step shows: storytree's saved reading (the default), storytree's own recorded growth (ADR-0889 2.2b)
   * or the shop's (ADR-0890). */
  map?: "own" | "shop";
  /** A recorded growth: held at its point ("seed"), or replayed over `seconds` as the step plays, whole or only its
   * named `stage` (from the globe as it stood before that stage, to where the next begins, or to where the stage named `until`
   * begins); absent, it is whole. Each beat has the replay reach its stage as its line begins, so a stage can wait for the
   * line that talks about it. */
  growth?: "seed" | { seconds: number; stage?: string; until?: string; beats?: readonly Beat[] };
  /** The moment in the shop's records its sessions list and its arcs read while the step replays its growth. */
  sessionsAt?: string;
  /** The stories a growth's globe is narrowed to: the rest are dimmed (ADR-0890's teaching stories). */
  focus?: readonly string[];
  target?: GlobeTarget; framing?: number; drift?: boolean;
  /** A laptop's own view where a phone's would not fit its panels (wider than 600px). */
  laptop?: { target: GlobeTarget; framing: number };
  /** A phone's own view (600px wide or less), with the globe's middle `side` pixels right of the screen's; at 320px wide
   * `narrow` pixels instead and framed `narrowFraming`, moving between the two from 390px down, so a narrower phone keeps its
   * islands' names in view. */
  phone?: { target?: GlobeTarget; framing: number; side: number; narrow?: number; narrowFraming?: number };
  /** A story selected so its dependency lanes draw on. */
  select?: string;
  panel?: "story" | "arcs" | "sessions" | "knowledge" | "note";
  /** The library note whose card the "note" panel opens. */
  note?: string;
  /** The recorded session whose reads the knowledge core draws while the step shows. */
  follow?: string;
  /** Leave the story panel's room before a later step opens it, so the globe does not slide when it does. */
  panelRoom?: boolean;
  /** Open the panel when this line is told, after the map has shown its preceding ideas. */
  panelFromLine?: number;
  /** The marks a step shows beneath its lines: the coding harnesses storytree works with. */
  marks?: readonly Mark[];
  /** One line beneath the marks, for the harnesses that have none. */
  marksNote?: string;
  /** The labels each line (1-based) puts on what it talks about, shown only while it is the current line. */
  labels?: Record<number, readonly Label[]>;
};
/** The replay reaches `stage` as line `line` (1-based) begins. */
export type Beat = { line: number; stage: string };
/** Free play's project: the example shop, whole (the default), or storytree's own saved project (ADR-0890). */
export type FreePlayProject = "shop" | "storytree";
/** `lines` are the lines told; `moments` the moments reached, lines and cues together (the same count where a step has no cues). */
export type TourState = {
  index: number; generation: number; lines: number; moments: number; speed: .75 | 1 | 1.5;
  holds: readonly Hold[]; freePlay: boolean; project: FreePlayProject;
};
export type TourDetail = { step: TourStep; state: TourState; running: boolean; elapsed: number };
/** Where the arrival's time-lapse stands, told every frame while it plays (ADR-0889 2.2). */
export type TourGrowth = { at: number; index: number; generation: number };
declare global {
  /** The window events between the page's chapters, the tour's controls (tour-ui.ts) and its globe (forest-scene.tsx). */
  interface WindowEventMap {
    "storytree-tour": CustomEvent<TourDetail>;
    "storytree-tour-request": Event;
    "storytree-tour-hold": CustomEvent<{ reason: Hold; held: boolean }>;
    "storytree-tour-growth": CustomEvent<TourGrowth>;
    "storytree-opening": CustomEvent<{ active: boolean }>;
    "storytree-arrived": Event;
  }
}

/** How long words take to say at 1×: 2.6 words a second. */
const spoken = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length / 2.6 * 1000;
/** Reading time at 1×, with a short floor even for a two-word line. */
export const readingTime = (text: string): number => Math.max(2800, spoken(text));
/** A step rests on its last line before the camera moves on. */
export const settle = 1200;
/** A step that replays a growth lasts as long as it does, however short its words. */
/** When each line begins, in seconds at 1×. */
export const lineStarts = (step: TourStep): number[] => step.lines.map((_, index) => step.lines.slice(0, index).reduce((sum, line) => sum + readingTime(line), 0) / 1000);
/** When each moment begins, in seconds at 1×: each line's start and each cue, in order. */
export const momentStarts = (step: TourStep): number[] => [...lineStarts(step), ...step.cues ?? []].sort((a, b) => a - b);
// A step lasts until its last cue has been read, as a line would be.
const duration = (step: TourStep) => Math.max(step.lines.reduce((sum, line) => sum + readingTime(line), 0), typeof step.growth === "object" ? step.growth.seconds * 1000 : 0,
  ...(step.cues ?? []).map(cue => cue * 1000 + readingTime(""))) + settle;
const reached = (starts: readonly number[], elapsed: number) => Math.max(1, starts.filter(start => elapsed >= start * 1000 - 1e-6).length);
const shown = (step: TourStep, elapsed: number) => reached(lineStarts(step), elapsed);

/** The link to a step's depth, worded the same on every step that has one (ADR-1018 D4). */
export const depthLink = (step: TourStep): string | undefined => step.how || step.why ? "Read more" : undefined;
/**
 * Which of a step's lines show once `lines` are told. A narrated stage shows one sentence at a time, each replacing the last
 * in the same place (ADR-1018 D5); a beat shows alone, but for its coda beneath the line before it; other steps keep each
 * line told. A waiting step (`still`) shows every line told, so a visitor who pauses can read the whole step.
 */
export function linesOn(step: TourStep, lines: number, still: boolean): boolean[] {
  return step.lines.map((_, index) => still || (step.template !== "narrated" && step.kind !== "beats") ? index < lines
    : step.kind === "beats" ? index === lines - 1 || (index === lines - 2 && lines === step.lines.length) : index === lines - 1);
}

/** The progress bar's groups: consecutive steps of one explainer share a group. */
export function groups(steps: readonly TourStep[]): { explainer: Group; steps: number[] }[] {
  const out: { explainer: Group; steps: number[] }[] = [];
  steps.forEach((step, index) => {
    const last = out.at(-1);
    if (last?.explainer === step.explainer) last.steps.push(index);
    else out.push({ explainer: step.explainer, steps: [index] });
  });
  return out;
}

/** `ready` says whether the globe a growth plays on is set up: until it is, the time-lapse and the step before it wait (2.10). */
export function createTour(steps: readonly TourStep[], { ready = () => true }: { ready?: () => boolean } = {}) {
  if (!steps.length) throw new Error("A tour needs at least one step.");
  let state: TourState = { index: 0, generation: 0, lines: 1, moments: 1, speed: .75, holds: [], freePlay: false, project: "shop" };
  let elapsed = 0;
  const update = (patch: Partial<TourState>) => state = { ...state, ...patch };
  const all = (index = state.index) => steps[index]!.lines.length;
  const every = (index = state.index) => momentStarts(steps[index]!).length;
  /** Moving to a step keeps only the visitor's own pause: a paused tour steps through by hand, each step shown whole. */
  const enter = (index: number) => {
    elapsed = 0;
    const holds = state.holds.includes("paused") ? ["paused" as const] : [];
    return update({ index, holds, lines: holds.length ? all(index) : 1, moments: holds.length ? every(index) : 1, freePlay: false });
  };
  const tour = {
    get state() { return state; },
    get running() { return !state.freePlay && state.holds.length === 0; },
    /** How far the current step has played, 0 to 1; it holds still while the tour waits. */
    progress() { return state.freePlay ? 1 : Math.min(1, elapsed / duration(steps[state.index]!)); },
    /** How long the current step has played, in milliseconds at its speed; it holds still while the tour waits. */
    elapsed() { return elapsed; },
    tick(milliseconds: number) {
      if (!tour.running || !Number.isFinite(milliseconds) || milliseconds <= 0) return state;
      const step = steps[state.index]!;
      const grows = (index: number) => typeof steps[index]?.growth === "object";
      if (grows(state.index) && !ready()) return state;
      elapsed += milliseconds * state.speed;
      if (elapsed >= duration(step) - 1e-6) {
        if (!grows(state.index + 1) || ready()) return tour.next();
        elapsed = duration(step) - 1e-6;
      }
      const lines = Math.max(state.lines, shown(step, elapsed)), moments = Math.max(state.moments, reached(momentStarts(step), elapsed));
      return lines === state.lines && moments === state.moments ? state : update({ lines, moments });
    },
    go(index: number) { return index < 0 || index >= steps.length ? state : enter(index); },
    next() {
      if (state.freePlay) return state;
      return state.index + 1 >= steps.length ? update({ freePlay: true, holds: [] }) : enter(state.index + 1);
    },
    previous() { return state.freePlay ? enter(steps.length - 1) : enter(Math.max(0, state.index - 1)); },
    replay() { elapsed = 0; return update({ index: 0, generation: state.generation + 1, lines: 1, moments: 1, holds: [], freePlay: false }); },
    skip() { return update({ freePlay: true, holds: [] }); },
    hold(reason: Hold) {
      if (state.freePlay || state.holds.includes(reason)) return state;
      return update({ holds: [...state.holds, reason], lines: all(), moments: every() });
    },
    release(reason: Hold) { return state.holds.includes(reason) ? update({ holds: state.holds.filter(hold => hold !== reason) }) : state; },
    /** Play clears every hold and continues the step where it stopped; pause is the visitor's own hold. */
    togglePlay() { return state.freePlay ? state : tour.running ? tour.hold("paused") : update({ holds: [] }); },
    setSpeed(speed: .75 | 1 | 1.5) { return update({ speed }); },
    /** The selector's choice of free play's project; it lasts as long as the page. */
    choose(project: FreePlayProject) { return state.project === project ? state : update({ project }); },
  };
  return tour;
}

/**
 * Where in a recorded growth's plan (its seconds) a step that replays it stands, `told` seconds into the step's replay:
 * across the whole growth, or across only its named stage, from where that stage begins to just short of where the next does,
 * or of the stage named `until` (2.12, 2.16). Each beat pins the replay to its stage's start as its line begins (`starts`,
 * seconds), and the replay runs evenly between them.
 */
export function replayMoment(plan: { seconds: number; stages: readonly { id: string; start: number }[] }, growth: { seconds: number; stage?: string; until?: string; beats?: readonly Beat[] }, told: number, starts: readonly number[] = []): number {
  const at = growth.stage === undefined ? -1 : plan.stages.findIndex(stage => stage.id === growth.stage);
  const until = growth.until === undefined ? undefined : plan.stages.find(stage => stage.id === growth.until)?.start;
  const from = at < 0 ? 0 : plan.stages[at]!.start, to = until ?? (at < 0 ? plan.seconds : plan.stages[at + 1]?.start ?? plan.seconds);
  // Short of `to`, so the stage it runs until is the next step's to show.
  const end = to > from && (until !== undefined || at >= 0) ? to - 1e-3 : to;
  const points = [{ told: 0, at: from },
    ...(growth.beats ?? []).map(beat => ({ told: starts[beat.line - 1] ?? 0, at: plan.stages.find(stage => stage.id === beat.stage)?.start ?? from })),
    { told: growth.seconds, at: end }];
  const now = Math.min(growth.seconds, Math.max(0, told));
  const next = points.findIndex(point => point.told > now);
  if (next <= 0) return next === 0 ? from : end;
  const a = points[next - 1]!, b = points[next]!;
  return a.at + (now - a.told) / (b.told - a.told) * (b.at - a.at);
}

/** The step as it stands once `lines` lines (or moments) are told: a line's view replaces the step's own from that line on. */
export function stepAt(step: TourStep, lines: number): TourStep {
  let shown = step;
  for (const [from, view] of Object.entries(step.lineViews ?? {})) if (lines >= Number(from)) shown = { ...shown, ...view };
  return shown;
}
/** Where the camera faces once `lines` lines are told, on a laptop (`wide`) or a phone. */
export function viewOf(step: TourStep, lines: number, wide: boolean): CameraView & { side?: number; narrow?: number } {
  const shown = stepAt(step, lines);
  return (wide ? shown.laptop : shown.phone) ?? { ...(shown.target ? { target: shown.target } : {}), framing: shown.framing ?? 1.1 };
}

/** A step's camera view: what it faces, and how close (the short half-side in globe radii). */
export type CameraView = { target?: GlobeTarget; framing: number };
/** The legs of the camera's flight from one step's view to the next on the same globe, in milliseconds at 1× (ADR-0879 D5). */
export function flight(from: CameraView, to: CameraView): { framing: number; ms: number }[] {
  // One eased flight turns the globe and zooms together: between close views it stays in and turns; to a wider view it pulls
  // back as it turns (2.15, narrowing D5's pull-back before far moves; the owner, 2026-10-04: "just stay zoomed in and rotate the globe").
  return [{ framing: to.framing, ms: JSON.stringify(from.target) === JSON.stringify(to.target) ? 1800 : 2000 }];
}

/**
 * Aims the camera at `target`, or at `overview` when a part or file is not on the globe. A globe swapped in can be drawn
 * after its step begins: an island not found yet is aimed at again on a later beat (`again`), so the camera never keeps the
 * last step's turn; after `tries` it gives up.
 */
export function aim(place: (target: GlobeTarget) => boolean, target: GlobeTarget, overview: GlobeTarget, again: (run: () => void) => void, tries = 100): void {
  if (place(target) || (target.kind !== "story" && place(overview))) return;
  if (tries > 0) again(() => aim(place, target, overview, again, tries - 1));
}

export type GlobeOn = { map: "storytree" } | { map: "own" | "shop"; at?: number; focus?: readonly string[] };
/**
 * The globe on show for `step` in `state`, `elapsed` milliseconds into it: a recorded growth's (storytree's own or the
 * shop's) at its moment in seconds or whole, narrowed to the step's focus (ADR-0889 2.2b), else storytree's saved reading.
 * Free play shows the project its selector chose (ADR-0890).
 */
export function globeOf(step: TourStep, state: TourState, elapsed = 0): GlobeOn {
  if (state.freePlay) return state.project === "shop" ? { map: "shop" } : { map: "storytree" };
  if (!step.map || state.holds.includes("everything")) return { map: "storytree" };
  const focus = step.focus ? { focus: step.focus } : {};
  if (step.growth === "seed") return { map: step.map, at: 0, ...focus };
  return step.growth ? { map: step.map, at: Math.min(step.growth.seconds, elapsed / 1000), ...focus } : { map: step.map, ...focus };
}

/**
 * The globe's two switches, Stories and Library, a step puts on (ADR-1002 D1): a step whose panel is the knowledge core turns
 * the islands off so the core shows alone; any other step, and free play, opens with both on, as a launch of the app does.
 */
export function switchesFor(panel: TourStep["panel"], free: boolean): GlobeSwitches {
  return { stories: free || panel !== "knowledge", library: true };
}

/**
 * The labels on show once `lines` lines (or moments) are told: the current one's own, none once it has passed (2.21). A
 * waiting step (`still`) shows every label its last line brings, so labels that arrive on a timer can all be read at once.
 */
export function labelsAt(step: TourStep, lines: number, { width = Infinity, still = false }: { width?: number; still?: boolean } = {}): readonly Label[] {
  const starts = momentStarts(step), from = still ? starts.indexOf(lineStarts(step).at(-1) ?? 0) + 1 : lines;
  return Array.from({ length: lines - from + 1 }, (_, index) => step.labels?.[from + index] ?? []).flat()
    .filter(label => "point" in label || width >= (label.narrowest ?? 0));
}

/** The part of a recorded frame a label reads. */
export type LabelFrame = {
  scene: { islands: readonly { story: string; trees: readonly { capability?: string | undefined }[]; land?: { files: readonly { path: string; lines: number }[]; territories: readonly { capability?: string | undefined; status?: string | undefined }[] } | undefined }[]; links?: readonly { from: string; to: string }[] | undefined };
  wisps: readonly { session: string; capabilities: readonly string[] }[];
};
/**
 * What a label says on `frame`, or nothing when the frame does not hold what it names (2.21): a story or link not drawn,
 * a file not surveyed, a capability no named session holds, a story neither all yellow nor all green.
 */
export function labelWords(label: Label, frame: LabelFrame, named: (session: string) => string | undefined): string | undefined {
  if ("point" in label) return undefined;
  const { target } = label, island = (story: string) => frame.scene.islands.find(island => island.story === story);
  if (target.kind === "pathway") return frame.scene.links?.some(link => `${link.from}->${link.to}` === target.link) ? label.text : undefined;
  if (target.kind === "story" && !island(target.story)) return undefined;
  if (label.read === "file" && target.kind === "file") {
    const file = island(target.story)?.land?.files.find(file => file.path === target.path);
    return file && `${label.text ? `${label.text}: ` : ""}${file.path.split("/").at(-1)} · ${file.lines} lines`;
  }
  if (label.read === "holder" && target.kind === "capability") {
    const holder = frame.wisps.find(wisp => wisp.capabilities.includes(target.capability));
    return holder && named(holder.session);
  }
  if (label.read === "health" && target.kind === "story") {
    const statuses = island(target.story)?.land?.territories.map(part => part.status) ?? [];
    if (!statuses.length) return undefined;
    if (statuses.every(status => status === "healthy")) return "tests passed";
    if (statuses.every(status => status === "proposed" || status === "untested")) return "not proved yet";
    return undefined;
  }
  return label.text;
}

export type Box = { x: number; y: number; width: number; height: number };
export type TagSide = "right" | "left" | "below" | "above";
const ring = 17, gap = 24, margin = 8;
const meet = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
/**
 * The drawn islands a label's words keep off, as hard boxes on the stage (2.24): `islands` are on the canvas, which sits at
 * `canvas` on the stage, and `at` is the label's ring on the stage. Every island is kept off but the one the label points
 * into: a story's or a file's by its story, a capability's as the island under its ring. A pathway, a note or the core points
 * into none, so a pathway's words leave the island its road runs from.
 */
export function islandsKeptOff(islands: readonly IslandBox[], target: GlobeTarget, at: { x: number; y: number }, canvas: { x: number; y: number }): Box[] {
  return islands.map(({ story, x, y, width, height }) => ({ story, x: x + canvas.x, y: y + canvas.y, width, height }))
    .filter(island => target.kind === "story" || target.kind === "file" ? island.story !== target.story
      : target.kind !== "capability" || !(at.x >= island.x && at.x <= island.x + island.width && at.y >= island.y && at.y <= island.y + island.height))
    .map(({ story: _, ...box }) => box);
}
/**
 * Where each tag's name sits, as its box's top-left from its ring's middle: `tags` are the rings' middles with their names'
 * sizes. A name takes the first of `sides` (its `previous` side first, so it does not flit) where it stays inside the room,
 * clear of the names already placed, the other rings and `keepOut`; where none is clear, the side that covers least, a
 * `soft` box (an island's name) counting a fifth as much as a ring, a name or a panel. With `share` (a laptop), a side is
 * clear allowing for rounding, and when taking sides first come, first served leaves a name over a ring, a name, a panel or
 * the room's edge, up to four names share the room instead: every choice of sides, a name above or below also flush with
 * its ring's left or right edge, is weighed and the one that covers least wins, the hard boxes first. A phone keeps the
 * first-come placement it was given, a name beside its ring also trying a little higher or lower once the four sides are
 * not clear (2.18; per line since 2.21). Last, on both, a name above or below steps further out from its ring (2.24).
 */
export function placeTags(tags: readonly Box[], room: { width: number; height: number }, { keepOut = [], sides = ["right", "left"], previous = [], share = false }: { keepOut?: readonly (Box & { soft?: boolean })[]; sides?: readonly TagSide[]; previous?: readonly (TagSide | undefined)[]; share?: boolean } = {}): { side: TagSide; x: number; y: number }[] {
  const rings = tags.map(tag => ({ x: tag.x - ring, y: tag.y - ring, width: ring * 2, height: ring * 2 }));
  // Each name's sides in the order it tries them, each with what it covers apart from the other names: `hard` counts the
  // rings, the panels and four times what falls outside the room; `cost` adds a fifth of the islands' names it covers.
  const options = tags.map((tag, index) => {
    const across = Math.min(Math.max(margin, tag.x - tag.width / 2), room.width - margin - tag.width) - tag.x;
    const offsets: Record<TagSide, { x: number; y: number }> = {
      right: { x: gap, y: -tag.height / 2 }, left: { x: -gap - tag.width, y: -tag.height / 2 },
      below: { x: across, y: gap }, above: { x: across, y: -gap - tag.height },
    };
    const order = [...new Set([previous[index], ...sides].filter((side): side is TagSide => !!side && sides.includes(side)))];
    // After the four sides, a name above or below may also sit flush with its ring's left or right edge rather than centred.
    const flush = !share ? [] : order.filter(side => side === "below" || side === "above").flatMap(side => [ring - tag.width, -ring].map(x => ({ side, x, y: offsets[side].y })));
    // On a phone, a name beside its ring may also slide up or down by up to half the ring, to clear an island's name.
    const slid = share ? [] : order.filter(side => side === "right" || side === "left").flatMap(side => [-ring / 4, ring / 4, -ring / 2, ring / 2].map(y => ({ side, x: offsets[side].x, y: offsets[side].y + y })));
    // Above or below its ring, a name may also step further out, by half a ring or a whole one, past islands and their names
    // crowding the ring (2.24).
    const further = order.filter(side => side === "below" || side === "above").flatMap(side => [ring / 2, ring].map(step => ({ side, x: offsets[side].x, y: offsets[side].y + (side === "below" ? step : -step) })));
    // A taller progress label can close the vertical gap. Move beside its edge, still within the screen, before covering it.
    const beside = share ? [] : order.filter(side => side === "right" || side === "left").flatMap(side => keepOut.map(other => ({ side,
      x: side === "right" ? Math.min(room.width - margin - tag.width - tag.x, Math.max(gap, other.x + other.width + margin - tag.x))
        : Math.max(margin - tag.x, Math.min(-gap - tag.width, other.x - margin - tag.width - tag.x)), y: offsets[side].y })))
      .filter(option => option.side === "right" ? option.x >= gap : option.x <= -gap - tag.width);
    return [...order.map(side => ({ side, ...offsets[side] })), ...flush, ...slid, ...beside, ...further].map(({ side, ...at }) => {
      const box = { x: tag.x + at.x, y: tag.y + at.y, width: tag.width, height: tag.height };
      const inside = tag.width * tag.height - meet(box, { x: margin, y: margin, width: room.width - margin * 2, height: room.height - margin * 2 });
      const outside = share ? Math.max(0, inside) : inside;
      const others = [...rings.filter((_, other) => other !== index), ...keepOut];
      const hard = outside * 4 + others.reduce((sum, other) => sum + ("soft" in other && other.soft ? 0 : meet(box, other)), 0);
      return { side, ...at, box, hard, cost: hard + others.reduce((sum, other) => sum + ("soft" in other && other.soft ? meet(box, other) * .2 : 0), 0) };
    });
  });
  // Sharing allows for rounding: fractional boxes can leave a side a hair above or below zero.
  const clear = (value: number) => share ? Math.abs(value) < 1e-6 : value === 0;
  const placed: Box[] = [];
  const first = options.map(sided => {
    const scored = sided.map(option => { const names = placed.reduce((sum, other) => sum + meet(option.box, other), 0); return { option, hard: option.hard + names, cost: option.cost + names }; });
    const best = scored.find(choice => clear(choice.cost)) ?? scored.reduce((a, b) => b.cost < a.cost ? b : a);
    placed.push(best.option.box);
    return best;
  });
  const weigh = (choice: readonly (typeof options)[number][number][]) => {
    const names = choice.reduce((sum, option, index) => sum + choice.slice(index + 1).reduce((more, other) => more + meet(option.box, other.box), 0), 0);
    return { hard: choice.reduce((sum, option) => sum + option.hard, 0) + names, cost: choice.reduce((sum, option) => sum + option.cost, 0) + names };
  };
  let chosen = first.map(({ option }) => option);
  if (share && !clear(first.reduce((sum, { hard }) => sum + hard, 0)) && tags.length <= 4) {
    let best = weigh(chosen);
    const choose = (index: number, choice: (typeof options)[number][number][]): void => {
      if (index === options.length) {
        const weighed = weigh(choice);
        if (weighed.hard < best.hard - 1e-6 || (clear(weighed.hard - best.hard) && weighed.cost < best.cost - 1e-6)) { best = weighed; chosen = [...choice]; }
        return;
      }
      for (const option of options[index]!) choose(index + 1, [...choice, option]);
    };
    choose(0, []);
  }
  return chosen.map(option => ({ side: option.side, x: option.x, y: option.y }));
}

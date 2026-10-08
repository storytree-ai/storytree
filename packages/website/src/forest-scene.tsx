/** Capability 2 · The forest on the site. */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { drillDown, type SessionWisp } from "@storytree/forest";
import { PlanetView, mountSessionsList, renderStoryPanel, attachPanZoom, mountTreeSpace, type GlobeControls, type GlobeSurfaces, type GlobeTarget } from "@storytree/forest/view";
import { workStates } from "@storytree/arc-surface";
import { mountArcSurface } from "@storytree/arc-surface/view";
import { knowledge } from "@storytree/knowledge-core";
import { createKnowledgeCore, KnowledgeNoteCard, type KnowledgeCore } from "@storytree/knowledge-core/view";
import saved from "./forest-snapshot.json" with { type: "json" };
import shopSaved from "./shop-snapshot.json" with { type: "json" };
import ownSaved from "./own-snapshot.json" with { type: "json" };
import { crossingLength, growthMoment, growthPlan, type GrowthPlan } from "@storytree/forest-world/planet";
import { buildPlanetPathways } from "@storytree/forest-world/geometry";
import type { GrowthSnapshot, TourSnapshot } from "./forest-data.js";
import { aim, flight, globeOf, placeTags, replayMoment, type Box, type GlobeOn, type Hold, type Tag, type TagSide, type TourDetail, type TourStep } from "./tour.js";
import { mapRecording, mapGrowthPlan, recordedFrame } from "./map-recording.js";
import { growthReading, savedReading } from "./tour-reading.js";

const snapshot = saved as unknown as TourSnapshot;
const places = new Map(snapshot.places.map(place => [place.id, place.place]));
/** A recorded growth to replay from a point: storytree's own (ADR-0889 2.2b), where Act 2 arrives, and the shop's, where its chapters teach (ADR-0890). */
function recordedGrowth(snapshot: GrowthSnapshot, mapChapter = false) {
  let planned: GrowthPlan | undefined;
  return { snapshot, places: new Map(snapshot.places.map(place => [place.id, place.place])), sessions: snapshot.stages.map(({ at, wisps }) => ({ at, wisps })),
    /** Planned on first use: a stage whose recorded sessions changed holds a beat, so each claim and landing is seen (world 7.6). */
    plan: () => planned ??= (() => {
      const pathways = buildPlanetPathways(snapshot.scene, new Map(snapshot.spots), snapshot.radius);
      if (mapChapter) return mapGrowthPlan(snapshot, link => crossingLength(pathways, link));
      const sessions = (index: number) => JSON.stringify(snapshot.stages[index]?.wisps.map(wisp => [wisp.session, wisp.story]) ?? []);
      const stages = snapshot.stages.map(({ id, at, scene }, index) => ({ id, at, scene, ...(sessions(index) !== sessions(index - 1) ? { hold: 1 } : {}) }));
      return growthPlan(stages, { fromPoint: true, seconds: 15, roadLength: link => crossingLength(pathways, link), until: snapshot.stages.at(-1)!.at });
    })() };
}
const shop = shopSaved as unknown as GrowthSnapshot;
const own = ownSaved as unknown as GrowthSnapshot;
const growths = { own: recordedGrowth(own), shop: recordedGrowth(shop) };
const mapChapter = recordedGrowth(mapRecording(shop), true);
const shopSnapshot = growthReading(shop);
type Grown = keyof typeof growths;
type GlobeMap = "storytree" | Grown;
const grows = (map: GlobeMap): map is Grown => map === "own" || map === "shop";
const notes = [...knowledge(snapshot.changes).notes.values()];
const complete: GlobeSurfaces = { sea: true, grounds: true, roads: true, nameplates: true, territories: "health", fileCircles: true, knowledgeCore: true, sessionTints: true };
const overviews: Record<GlobeMap, GlobeTarget> = { storytree: { kind: "story", story: "story_deee4230348c" }, own: { kind: "core" }, shop: { kind: "core" } };
/** The globe at rest fills most of the short side (ADR-0877 D2). */
const restingFraming = 1.1;
type Recording = ReturnType<typeof savedReading>;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const hold = (reason: Hold, held = true) => window.dispatchEvent(new CustomEvent("storytree-tour-hold", { detail: { reason, held } }));
const ownerOf = (target: GlobeTarget | undefined) => target?.kind === "story" ? target.story : target?.kind === "capability"
  ? snapshot.tree.stories.find(owner => owner.capabilities.some(item => item.id === target.capability))?.id : undefined;
/** The session that read most in the recording: the sessions explainer follows its path. */
const reader = (() => {
  const reads = new Map<string, number>();
  for (const line of snapshot.recording.lines as readonly { kind: string; session?: string }[]) if (line.kind === "note-read" && line.session) reads.set(line.session, (reads.get(line.session) ?? 0) + 1);
  return [...reads].sort((a, b) => b[1] - a[1])[0]?.[0];
})();
/** Overview steps drift round the islands in their places' order, one leg at a time. */
const order = (nodes: readonly { id: string; place: number }[]) => [...nodes].sort((a, b) => a.place - b.place).map(place => place.id);
const driftOrders: Record<GlobeMap, string[]> = { storytree: order(snapshot.places), own: order(own.places), shop: order(shop.places) };

/** A lost graphics context leaves the saved picture and the readable app surfaces available. */
class GlobeBoundary extends Component<{ children: ReactNode; failed(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.failed(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function StoryDetails({ saved, story, capability, choose, close }: { saved: TourSnapshot; story: string; capability: string | undefined; choose(id: string): void; close(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const panel = useMemo(() => drillDown(saved.tree, story, workStates(saved.recording.lines as Recording["lines"]), saved.changes), [saved, story]);
  useEffect(() => {
    const host = ref.current;
    if (!host || !panel) return;
    host.innerHTML = renderStoryPanel(panel, capability);
    const frame = host.querySelector<HTMLElement>(".panel-tree-frame");
    const surface = host.querySelector<HTMLElement>(".panel-tree-surface");
    const moving = frame && surface ? attachPanZoom(frame, surface, choose) : undefined;
    moving?.open();
    const large = mountTreeSpace(document.querySelector<HTMLElement>("#chapter2")!, { choose, closed() {} });
    host.querySelector("[data-open-tree]")?.addEventListener("click", () => large.show(panel, capability));
    host.querySelector(".panel-close")?.addEventListener("click", close);
    return () => { moving?.stop(); large.stop(); };
  }, [panel, capability, choose, close]);
  return <div ref={ref} className="story-panel tour-story-panel" data-story-id={story} />;
}

function Sessions({ project, recording, core, onWisps, onHighlight, onPick }: { project: string; recording: Recording; core: KnowledgeCore; onWisps(wisps: readonly SessionWisp[]): void; onHighlight(stories: readonly string[] | undefined): void; onPick(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = mountSessionsList(ref.current!, { project, reads: recording.reads,
      reading: recording.reading, now: recording.now, onWisps, onHighlight,
      onRoster: roster => core.showRoster(roster), onSelect: session => { onPick(); core.select(session); } });
    const stop = core.onSelect(session => list.select(session));
    return () => { stop(); list.stop(); };
  }, [project, recording, core, onWisps, onHighlight, onPick]);
  return <div ref={ref} className="tour-sessions" />;
}

function Arcs({ project, recording, open }: { project: string; recording: Recording; open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useRef<ReturnType<typeof mountArcSurface>>(undefined);
  useEffect(() => {
    mounted.current = mountArcSurface(ref.current!, { project, reads: recording.reads, timers: recording.timers, reading: recording.reading });
    return () => { mounted.current?.stop(); mounted.current = undefined; };
  }, [project, recording]);
  useEffect(() => { if (open) mounted.current?.open(); else mounted.current?.close(); }, [open]);
  return <div ref={ref} className="tour-arcs" />;
}

/** Rings on the things a step talks about, placed on the drawing every frame once the camera has arrived. */
function Tags({ tags, controls, arrived }: { tags: readonly Tag[]; controls: GlobeControls | undefined; arrived: boolean }) {
  const host = document.getElementById("tour-tags");
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (!controls || !host || !tags.length) return;
    let frame = 0, previous: (TagSide | undefined)[] = [];
    const place = () => {
      const canvas = document.querySelector("#website-forest canvas")?.getBoundingClientRect(), stage = host.getBoundingClientRect();
      const shown: { node: HTMLDivElement; label: HTMLElement; box: Box; index: number }[] = [];
      tags.forEach((tag, index) => {
        const node = refs.current[index];
        if (!node) return;
        const at = canvas ? controls.position(tag.target) : undefined;
        if (!at || !canvas || !at.visible || !arrived) { node.classList.add("away"); return; }
        const x = at.x + canvas.left - stage.left, y = at.y + canvas.top - stage.top;
        node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        const label = node.lastElementChild as HTMLElement;
        const size = label.getBoundingClientRect();
        // Score the rounded position we draw, with room for fractional text sizes and the label offset's rounding.
        shown.push({ node, label, box: { x: Math.round(x), y: Math.round(y), width: Math.ceil(size.width), height: Math.ceil(size.height) }, index });
      });
      // Each name sits on whichever side of its ring has room, clear of the other names, the other rings, the islands' names,
      // the card and the panels, below or above the ring where the sides have no room (2.18). A phone keeps a name on its
      // last side so it does not flit as the globe turns; a laptop has the room to take the first clear side every frame,
      // so a side chosen while a panel slid in is not kept once it has gone, and its names share the room when the first
      // clear sides leave one covered.
      const room = { width: stage.width, height: stage.height };
      const phone = stage.width <= 600;
      // On a phone, the names of the islands the tags point at are as hard to cover as a panel: the step talks about those
      // islands, and in a short band its tags can otherwise trade one for an untagged island's name.
      const named = new Set(phone ? tags.flatMap(tag => tag.target.kind === "story" ? [tag.target.story] : []) : []);
      const keepOut = [...document.querySelectorAll("#chapter2 :is(.tour-card, .sessions-list, .arc-overlay, .arc-handle), #website-forest .planet-nameplate:not(.crowded)")]
        .filter(node => getComputedStyle(node).visibility === "visible").map(node => ({ box: node.getBoundingClientRect(), soft: node.classList.contains("planet-nameplate") && !named.has((node as HTMLElement).dataset.storyId ?? "") }))
        .filter(({ box }) => box.width && box.height)
        .map(({ box, soft }) => ({ x: box.left - stage.left, y: box.top - stage.top, width: box.width, height: box.height, soft }));
      const sides = shown.length ? placeTags(shown.map(item => item.box), room, { keepOut, sides: ["right", "left", "below", "above"], previous: phone ? shown.map(item => previous[item.index]) : [], share: !phone }) : [];
      previous = [];
      shown.forEach(({ node, label, index }, at) => {
        const side = sides[at]!;
        previous[index] = side.side;
        label.style.left = `${Math.round(side.x)}px`;
        label.style.top = `${Math.round(side.y)}px`;
        node.classList.remove("away");
      });
      frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [tags, controls, host, arrived]);
  if (!host) return null;
  return createPortal(<>{tags.map((tag, index) => <div key={index} ref={node => { refs.current[index] = node; }} className="tour-tag away"
    data-story={tag.target.kind === "story" ? tag.target.story : undefined}>
    <span className="tour-tag-ring" /><span className="tour-tag-text">{tag.text}</span>
  </div>)}</>, host);
}

/** Where the globe's middle sits: in the room the card (left) and any side panel (right) leave it. */
function offsetFor(step: TourStep | undefined, width: number) {
  if (!step || width <= 600) {
    const { side = 0, narrow = side } = step?.phone ?? {};
    return Math.round(side + (narrow - side) * Math.min(1, Math.max(0, (390 - width) / 70)));
  }
  const opening = step.kind === "beats" || step.kind === "statement" || step.kind === "fixes";
  // A chapter's lines start where the arrival's do (ADR-0890, amended 2026-10-05).
  const cardRight = Math.min(64, width * .04) + (opening ? Math.min(560, width * .46) : Math.min(400, width * .36));
  const panel = step.panel === "story" ? Math.min(480, width - 24) + 12 : 0;
  return Math.round(Math.min(width * .2, (cardRight - panel) / 2));
}

type ForestHost = { ready(): void; failed(): void; webgl: boolean };
function Forest({ core, recording, replay, finishRecording, ready, failed, webgl }: ForestHost & { core: KnowledgeCore; recording: Recording; replay(): void; finishRecording(): void }) {
  const [tour, setTour] = useState<TourDetail>();
  const [controls, setControls] = useState<GlobeControls>();
  const [wisps, setWisps] = useState<readonly SessionWisp[]>([]);
  const [highlight, setHighlight] = useState<readonly string[]>();
  const [story, setStory] = useState<string>();
  const [capability, setCapability] = useState<string>();
  const [note, setNote] = useState<string>();
  const [mode, setMode] = useState<"forest" | "library">("forest");
  const [query, setQuery] = useState("");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [width, setWidth] = useState(window.innerWidth);
  const [arrived, setArrived] = useState(false);
  // Each growth's own knowledge core, its notes appearing as the time-lapse reaches their dates (knowledge core 1.9).
  const growthCores = useMemo(() => Object.fromEntries((Object.keys(growths) as Grown[]).map(map => {
    const made = createKnowledgeCore(growths[map].snapshot.project); made.take(growths[map].snapshot.changes ?? [], []); return [map, made];
  })) as Record<Grown, KnowledgeCore>, []);
  useEffect(() => () => Object.values(growthCores).forEach(made => made.dispose()), [growthCores]);
  // The shop's saved reading, at rest at its end, for free play on the shop (2.14).
  const shopView = useMemo(() => shopSnapshot && { recording: savedReading(shopSnapshot) }, []);
  useEffect(() => () => shopView?.recording.reading.stop(), [shopView]);
  // Where the arrival's time-lapse stands: told every frame by the tour while it plays (ADR-0889 2.2).
  const [growthAt, setGrowthAt] = useState<{ at: number; index: number; generation: number }>();
  useEffect(() => {
    const hear = (event: Event) => setGrowthAt((event as CustomEvent<{ at: number; index: number; generation: number }>).detail);
    window.addEventListener("storytree-tour-growth", hear);
    return () => window.removeEventListener("storytree-tour-growth", hear);
  }, []);
  // The globe on show lags the step's while the camera pulls back to swap one project's globe for the other.
  const [shownMap, setShownMap] = useState<GlobeMap>("storytree");
  const shownMapNow = useRef<GlobeMap>("storytree");
  shownMapNow.current = shownMap;
  // The core on show: a growth's own, or storytree's saved reading's.
  const activeCore = grows(shownMap) ? growthCores[shownMap] : core;
  useEffect(() => { const resize = () => setWidth(window.innerWidth); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  const [progress, setProgress] = useState(recording.progress);
  const [openingActive, setOpeningActive] = useState(() => document.getElementById("opening")?.hidden === false);
  const camera = useRef<{ target?: GlobeTarget; framing: number; entered: boolean; flight: number[]; drift: number[]; dive?: (() => void) | undefined }>({ framing: restingFraming, entered: false, flight: [], drift: [] });
  const previous = useRef<TourDetail | undefined>(undefined);
  const latest = useRef<TourDetail | undefined>(undefined);
  latest.current = tour;
  const recordingAt = useRef<{ inSessions: boolean; generation: number } | undefined>(undefined);
  const wasExploring = useRef(false);
  const panelHost = document.querySelector<HTMLElement>("#chapter2");
  const step = tour?.step;
  const state = tour?.state;
  const free = state?.freePlay === true;
  const everything = state?.holds.includes("everything") === true;
  const touring = !!tour && !free;
  const requestedPanel = touring && !everything && (state?.lines ?? 1) >= (step?.panelFromLine ?? 1) ? step?.panel : undefined;
  const surfaces = useMemo((): Partial<GlobeSurfaces> => {
    if (!step || free || everything) return complete;
    let shown = step.surfaces;
    for (const [from, next] of Object.entries(step.lineSurfaces ?? {})) if ((state?.lines ?? 1) >= Number(from)) shown = next;
    return shown;
  }, [step, state?.lines, free, everything]);
  const sideOffset = offsetFor(touring && !everything ? step : undefined, width);
  const globe: GlobeOn = step && state ? globeOf(step, state, tour!.elapsed) : { map: "storytree" };

  // Touching the globe hands it to the visitor: the tour waits, and says so (ADR-0879 D3).
  const explore = useCallback(() => { if (touring) { controls?.cancel(); clearFlight(); clearDrift(); hold("exploring"); } }, [touring, controls]);
  const clearFlight = () => { camera.current.flight.forEach(clearTimeout); camera.current.flight = []; camera.current.dive = undefined; };
  const clearDrift = () => { camera.current.drift.forEach(clearTimeout); camera.current.drift = []; };
  const pickStory = useCallback((id: string | undefined, picked?: string) => {
    explore(); setStory(id); setCapability(picked); setNote(undefined); core.pin(undefined);
  }, [core, explore]);
  const pickCapability = useCallback((id: string) => { explore(); setCapability(id); }, [explore]);
  const closeStory = useCallback(() => { setStory(undefined); setCapability(undefined); }, []);
  const pickNote = useCallback((id: string) => { explore(); setNote(id); setStory(undefined); activeCore.pin(id); }, [activeCore, explore]);
  const closeNote = useCallback(() => { setNote(undefined); activeCore.pin(undefined); }, [activeCore]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key !== "Escape" || event.defaultPrevented) return; if (note) closeNote(); else if (story) closeStory(); else setBrowserOpen(false); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [note, story, closeNote, closeStory]);
  // A recording restart replaces the core, but the visitor is still reading this note.
  useEffect(() => { activeCore.pin(note); }, [activeCore, note]);
  const onHighlight = useCallback((stories: readonly string[] | undefined) => setHighlight(stories), []);
  const onControls = useCallback((next: GlobeControls | undefined) => setControls(next), []);
  useEffect(() => {
    let first = true;
    const hear = (event: Event) => {
      const detail = (event as CustomEvent<TourDetail>).detail;
      // The first globe drawn is the step's own: under Act 2's pain that is the shop's seed, never a flash of another (2.10).
      if (first) { first = false; setShownMap(globeOf(detail.step, detail.state, detail.elapsed).map); }
      setTour(detail);
    };
    window.addEventListener("storytree-tour", hear);
    window.dispatchEvent(new Event("storytree-tour-request"));
    return () => window.removeEventListener("storytree-tour", hear);
  }, []);

  // The recording plays through the sessions explainer and rests at its end everywhere else.
  useEffect(() => {
    if (!tour) return;
    const before = recordingAt.current;
    const inSessions = !free && step?.panel === "sessions" && !step.recorded;
    const wasInSessions = before?.inSessions === true && before.generation === state!.generation;
    recordingAt.current = { inSessions, generation: state!.generation };
    if (inSessions && !wasInSessions) replay();
    else if (!inSessions && before && (before.inSessions || before.generation !== state!.generation)) finishRecording();
  }, [step?.id, state?.generation, free]);
  useEffect(() => {
    const opening = (event: Event) => {
      const active = (event as CustomEvent<{ active: boolean }>).detail.active;
      // The first view waits for chapter 1 to hand over, so it grows in where the visitor is looking.
      if (active) camera.current.entered = false;
      setOpeningActive(active);
    };
    window.addEventListener("storytree-opening", opening);
    return () => window.removeEventListener("storytree-opening", opening);
  }, []);
  useEffect(() => {
    let clock = performance.now();
    let index = recording.progress().index;
    setProgress(recording.progress());
    if (!tour?.running || index === recording.progress().total) return;
    let frame: number;
    const tick = (now: number) => {
      const delta = Math.min(now - clock, 1000);
      clock = now;
      const next = recording.advance(delta, { paused: document.hidden, speed: state?.speed ?? 1 });
      if (next.index !== index) { index = next.index; setProgress(next); }
      if (index < next.total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [recording, tour?.running, state?.speed]);
  useEffect(() => {
    if (!controls) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(ready));
    return () => cancelAnimationFrame(frame);
  }, [controls, ready]);

  // Each step opens what it talks about (ADR-0852 D3).
  const openStepSurfaces = () => {
    if (!tour || free) return;
    setMode(requestedPanel === "knowledge" ? "library" : "forest");
    setNote(undefined); core.pin(undefined); setBrowserOpen(false);
    // A phone has no room for the app’s story panel beside the card: the step says it in words instead.
    if (requestedPanel === "story" && window.innerWidth > 600) { setStory(ownerOf(step!.target)); setCapability(step!.target?.kind === "capability" ? step!.target.capability : undefined); }
    else { setStory(undefined); setCapability(undefined); }
    if (step?.id === "knowledge-reads" && reader) core.select(reader);
  };
  useEffect(openStepSurfaces, [step?.id, state?.generation, free, everything, requestedPanel]);
  // Resuming after exploring closes what the visitor opened and puts the step's own surfaces back.
  const exploringNow = state?.holds.includes("exploring") === true;
  useEffect(() => {
    if (wasExploring.current && !exploringNow) openStepSurfaces();
    wasExploring.current = exploringNow;
  }, [exploringNow]);

  // The camera flies; it never snaps (ADR-0879 D5). Between close steps it stays in and turns the globe (2.15).
  useEffect(() => {
    if (!tour || !controls || free || !step || openingActive) return;
    const before = previous.current;
    previous.current = tour;
    if (exploringNow || everything) { clearDrift(); if (everything && shownMapNow.current !== "storytree") setShownMap("storytree"); return; }
    const moved = !before || before.state.index !== state!.index || before.state.generation !== state!.generation || before.state.freePlay
      || before.state.holds.includes("exploring") || before.state.holds.includes("everything") || !camera.current.entered;
    const map = globe.map, overview = overviews[map], driftOrder = driftOrders[map];
    const view = (width > 600 ? step.laptop : step.phone) ?? step;
    const target = view.target ?? overview, framing = view.framing ?? restingFraming;
    const speed = state!.speed, still = reduced();
    const after = (timers: number[], ms: number, run: () => void) => { timers.push(window.setTimeout(run, ms)); };
    const go = (stop: { target: GlobeTarget; framing: number; duration: number }, timers = camera.current.flight) =>
      aim(target => controls.stop({ ...stop, target, sideOffset }), stop.target, overview, again => after(timers, 50, again));
    const drift = (from: number) => {
      if (!step.drift || still) return;
      const story = driftOrder[from % driftOrder.length]!;
      go({ target: { kind: "story", story }, framing, duration: 18_000 / speed }, camera.current.drift);
      after(camera.current.drift, 18_000 / speed, () => drift(from + 1));
    };
    const next = () => driftOrder.indexOf(ownerOf(target) ?? "") + 1;
    if (!moved) {
      // The same step: waiting freezes the drift; playing again returns to the step's view and drifts on. Flights finish.
      if (!tour.running) clearDrift();
      else if (before && !before.running && step.drift) { clearDrift(); go({ target, framing, duration: 1400 / speed }); after(camera.current.drift, 1400 / speed, () => drift(next())); }
      return;
    }
    clearFlight(); clearDrift();
    setArrived(false);
    const first = !camera.current.entered;
    camera.current.entered = true;
    const from = { ...camera.current };
    let arrive = 0;
    const land = () => { setArrived(true); if (latest.current?.running) drift(next()); };
    const switching = map !== shownMapNow.current;
    // A globe that grows from a point needs no pull back and dive: the old one gives way to the new one's point, which swells
    // where the visitor is already looking (2.12; owner, 2026-10-05: "is this really needed?").
    const swells = typeof step.growth === "object" && step.growth.stage === undefined;
    if (switching && (still || first || swells)) setShownMap(map);
    if (still) after(camera.current.flight, switching ? 60 : 0, () => go({ target, framing, duration: 0 }));
    else if (switching && !first && !swells) {
      // One project's globe for the other (ADR-0879 D7): pull back until the globe is small, swap it there, and dive into the new one.
      const wide = Math.max(from.framing, framing, 1) * 2.4;
      go({ target: from.target ?? overviews[shownMapNow.current], framing: wide, duration: 900 / speed });
      // The dive waits for the new globe to be drawn: a heavy globe can take longer to lay out than any fixed beat.
      after(camera.current.flight, 900 / speed, () => {
        camera.current.dive = () => {
          go({ target: overview, framing: wide, duration: 0 });
          after(camera.current.flight, 60 / speed, () => go({ target, framing, duration: 1500 / speed }));
          after(camera.current.flight, 1560 / speed, land);
        };
        setShownMap(map);
      });
      arrive = -1;
    } else if (first) {
      // Chapter 2's first view grows in from far away, out of the point chapter 1 ends on.
      // The far pose lands first (one beat), so the flight in starts from it rather than from a stale zoom.
      go({ target, framing: framing * 7, duration: 0 });
      after(camera.current.flight, 60, () => go({ target, framing, duration: 2600 }));
      arrive = 2660;
    } else {
      // The legs follow one another; each turns the globe and zooms at once.
      for (const leg of flight(from, { target, framing })) {
        const fly = () => go({ target, framing: leg.framing, duration: leg.ms / speed });
        if (arrive) after(camera.current.flight, arrive, fly); else fly();
        arrive += leg.ms / speed;
      }
    }
    if (arrive >= 0) after(camera.current.flight, arrive, land);
    camera.current.target = target; camera.current.framing = framing;
  }, [controls, tour, sideOffset, openingActive, globe.map]);
  // Once a swapped globe is drawn, the camera dives into it.
  useEffect(() => {
    if (!camera.current.dive) return;
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { const dive = camera.current.dive; camera.current.dive = undefined; dive?.(); }); });
    return () => cancelAnimationFrame(frame);
  }, [shownMap]);
  // Free play shows the project its selector chose (ADR-0890): the whole shop, or storytree's own. A switch closes what
  // the visitor had open on the other and frames the new globe whole.
  useEffect(() => {
    if (!free || shownMap === globe.map) return;
    setStory(undefined); setCapability(undefined); setNote(undefined); setBrowserOpen(false);
    setShownMap(globe.map);
  }, [free, globe.map, shownMap]);
  useEffect(() => {
    if (!free || !controls) return;
    const frame = requestAnimationFrame(() => controls.stop({ target: overviews[shownMap], framing: restingFraming, duration: reduced() ? 0 : 1200, sideOffset: 0 }));
    return () => cancelAnimationFrame(frame);
  }, [free, shownMap, controls]);
  useEffect(() => () => { clearFlight(); clearDrift(); }, []);

  // Find reads the project on show: its islands and its notes.
  const shownNotes = (grows(shownMap) ? [...knowledge(growths[shownMap].snapshot.changes ?? []).notes.values()] : notes).filter(item => String(item.fields.title ?? "").toLowerCase().includes(query.toLowerCase()));
  const selected = story ?? (touring && !everything ? step?.select : undefined);
  const onStorytree = shownMap === "storytree";
  const inMapChapter = touring && !everything && step?.explainer === "map" && shownMap === "shop";
  const grown = inMapChapter ? mapChapter : grows(shownMap) ? growths[shownMap] : undefined;
  // The tour's step says how far the growth has played (seconds at 1×), over the whole plan or one stage of it (2.16).
  // Undefined is whole; a held seed is the point the globe grows from.
  let moment: number | undefined;
  if (grown && globe.map === shownMap && "at" in globe && globe.at !== undefined) {
    const told = growthAt && growthAt.index === state?.index && growthAt.generation === state?.generation ? growthAt.at : globe.at;
    moment = typeof step?.growth === "object" ? replayMoment(grown.plan(), step.growth, told) : 0;
  }
  // A step at a recorded moment shows the shop as it stood then: its globe, and its sessions and arcs read from its records (2.17).
  const recordedAt = touring && !everything && globe.map === "shop" && "when" in globe ? globe.when : undefined;
  if (grown && recordedAt && globe.map === shownMap) moment = growthMoment(grown.plan(), recordedAt);
  const growth = grown ? { plan: grown.plan(), at: moment ?? Infinity } : undefined;
  // A step narrowed to a few stories dims the rest (ADR-0890's three teaching stories).
  const focus = touring && !everything && globe.map === shownMap && "focus" in globe ? globe.focus : undefined;
  const datedFrame = grown && moment !== undefined && (inMapChapter || recordedAt) ? recordedFrame(grown.snapshot, grown.plan(), moment) : undefined;
  const mapFrame = inMapChapter ? datedFrame : undefined;
  const drawn = datedFrame?.scene ?? grown?.snapshot.scene ?? snapshot.scene;
  // Free play on the shop reads the shop's saved reading for its panels, arcs and sessions; everywhere else, storytree's.
  const onShop = free && shownMap === "shop" && shopView !== undefined;
  const shopAt = useMemo(() => recordedAt && shopSnapshot ? { recording: savedReading(shopSnapshot, { until: recordedAt }) } : undefined, [recordedAt]);
  useEffect(() => () => shopAt?.recording.reading.stop(), [shopAt]);
  const panelReading = onStorytree ? snapshot : shownMap === "shop" ? shopSnapshot : undefined;
  const shownProgress = onShop ? shopView.recording.progress() : shopAt ? shopAt.recording.progress() : progress;
  // While the shop's sessions are on show, its core hears their recorded reads, as storytree's core hears its own.
  useEffect(() => {
    if (!onShop) return;
    return shopView.recording.reading.subscribe({ onNews: news => growthCores.shop.take(shop.changes ?? [], news.lines) });
  }, [onShop, shopView, growthCores]);
  return <>
    {webgl && tour && <GlobeBoundary failed={failed}>
      <div className="forest-drawing" role="group" aria-label={onStorytree ? "Storytree’s saved project globe" : shownMap === "own" ? "Storytree’s own globe, growing as its agents built it" : "An online shop’s globe, as its agents built it"}
        data-globe={shownMap} data-arrived={arrived} data-growth={grown ? moment === undefined ? "whole" : moment.toFixed(2) : undefined} data-focus={focus?.join(" ")}
        data-islands={drawn.islands.length} data-risen={growth ? [...growth.plan.islands.values()].filter(window => window.start <= growth.at).length : undefined} onPointerDown={explore} onWheel={explore}>
        <PlanetView core={grown ? growthCores[shownMap as Grown] : core} scene={drawn} places={grown?.places ?? places}
          frame={grown?.snapshot.scene} growth={growth} recordedSessions={mapFrame || (shopAt && shownMap === "shop") ? undefined : grown?.sessions}
          wisps={mapFrame?.wisps ?? (shopAt && shownMap === "shop" ? wisps : grown ? [] : wisps)} selected={selected}
          highlighted={focus?.length === 0 ? ["planned-only"] : focus ?? highlight} onPick={pickStory} onNote={pickNote}
          onControls={onControls} surfaces={surfaces} framing={restingFraming} sideOffset={offsetFor(undefined, width)} mode={mode} />
      </div>
    </GlobeBoundary>}
    {touring && !everything && step?.tags && <Tags tags={step.tags} controls={controls} arrived={arrived} />}
    {panelHost && createPortal(<>
      <div className="forest-views" role="group" aria-label="Project view" hidden={!free}>
        <button type="button" aria-pressed={mode === "forest"} onClick={() => setMode("forest")}>Forest</button>
        <button type="button" aria-pressed={mode === "library"} onClick={() => setMode("library")}>Library</button>
      </div>
      <button className="tour-browse-toggle" type="button" aria-label="Find a story or note in the saved project" aria-expanded={browserOpen} hidden={!free} onClick={() => setBrowserOpen(value => !value)}>Find</button>
      <div className="tour-record-browser" hidden={!browserOpen || !free}>
        <header><h2>Saved project</h2><button type="button" aria-label="Close project browser" onClick={() => setBrowserOpen(false)}>×</button></header>
        <p className="tour-recorded-label">{grows(shownMap) ? `Recorded ${growths[shownMap].snapshot.window.to.slice(0, 10)}` : `Saved ${snapshot.capturedAt.slice(0, 10)}`} · read only</p>
        <label htmlFor="tour-story-choice">Open a story</label>
        <select id="tour-story-choice" value={story ?? ""} onChange={event => { pickStory(event.target.value); controls?.stop({ target: { kind: "story", story: event.target.value }, framing: .6, duration: reduced() ? 0 : 1400 }); setBrowserOpen(false); }}>
          <option value="" disabled>Choose an island…</option>
          {(grows(shownMap) ? Object.entries(growths[shownMap].snapshot.titles).map(([id, title]) => ({ id, title })) : snapshot.tree.stories).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <div className="tour-knowledge" onKeyDown={event => {
          if (event.key !== "Escape" || !note) return;
          event.preventDefault(); event.stopPropagation(); closeNote();
          document.getElementById("tour-note-choice")?.focus();
        }}>
          <label htmlFor="tour-note-search">Find a note in the library</label>
          <input id="tour-note-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search decisions and guidance" />
          <label htmlFor="tour-note-choice">Library note</label>
          <select id="tour-note-choice" value={note ?? ""} onChange={event => { pickNote(event.target.value); setBrowserOpen(false); }}>
            <option value="" disabled>Choose a note…</option>
            {shownNotes.map(item => <option key={item.id} value={item.id}>{String(item.fields.title ?? item.id)}</option>)}
          </select>
          {shownNotes.length === 0 && <p>No saved notes match that search.</p>}
        </div>
      </div>
      {story && panelReading?.tree.stories.some(item => item.id === story) && <StoryDetails saved={panelReading} story={story} capability={capability} choose={pickCapability} close={closeStory} />}
      {note && <div className="story-panel" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); closeNote(); } }}><KnowledgeNoteCard core={activeCore} onClose={closeNote} /></div>}
      {/* The recorded sessions and the arcs of the project on show: the shop's in free play on it, storytree's otherwise. */}
      <div className="tour-session-surface" hidden={free ? !onStorytree && !onShop : requestedPanel !== "sessions"}>
        {shopAt
          ? <Sessions key={`shop@${recordedAt}`} project={shop.project} recording={shopAt.recording} core={growthCores.shop} onWisps={setWisps} onHighlight={onHighlight} onPick={explore} />
          : onShop
          ? <Sessions key="shop" project={shop.project} recording={shopView.recording} core={growthCores.shop} onWisps={setWisps} onHighlight={onHighlight} onPick={explore} />
          : <Sessions key="storytree" project={snapshot.project} recording={recording} core={core} onWisps={setWisps} onHighlight={onHighlight} onPick={explore} />}
        <p className="tour-recording-progress" data-recording-index={shownProgress.index} data-recording-total={shownProgress.total}>
          Recording · <time dateTime={shownProgress.at}>{shownProgress.at.slice(11, 16)} UTC</time> · {shownProgress.index} of {shownProgress.total} events
        </p>
      </div>
      <div className="tour-arc-surface" hidden={free ? !onStorytree && !onShop : requestedPanel !== "arcs"}>
        {shopAt
          ? <Arcs key={`shop@${recordedAt}`} project={shop.project} recording={shopAt.recording} open={requestedPanel === "arcs"} />
          : onShop
          ? <Arcs key="shop" project={shop.project} recording={shopView.recording} open={false} />
          : <Arcs key="storytree" project={snapshot.project} recording={recording} open={requestedPanel === "arcs"} />}
      </div>
    </>, panelHost)}
  </>;
}

/** A replay gets a fresh app reading and core, so its prior traversal never leaks into its start. */
function recordedView(replay = false) {
  const recording = savedReading(snapshot, { replay });
  const core = createKnowledgeCore(snapshot.project);
  const stopHearing = recording.reading.subscribe({ onNews: news => core.take(snapshot.changes, news.lines) });
  return { recording, core, stop() { stopHearing(); core.dispose(); recording.reading.stop(); } };
}

function RecordedForest(props: ForestHost) {
  const [view, setView] = useState(() => recordedView());
  useEffect(() => () => view.stop(), [view]);
  const replay = useCallback(() => setView(recordedView(true)), []);
  const finishRecording = useCallback(() => setView(recordedView()), []);
  return <Forest {...props} core={view.core} recording={view.recording} replay={replay} finishRecording={finishRecording} />;
}

export function mountForest(host: HTMLElement, ready: () => void, failed: () => void, webgl = true): () => void {
  const root = createRoot(host);
  root.render(<RecordedForest ready={ready} failed={failed} webgl={webgl} />);
  const lost = () => failed();
  host.addEventListener("webglcontextlost", lost, true);
  return () => { host.removeEventListener("webglcontextlost", lost, true); root.unmount(); };
}

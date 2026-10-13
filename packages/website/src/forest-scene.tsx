/** Capability 2 · The forest on the site. */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { drillDown } from "@storytree/forest";
import { PlanetView, flipSwitch, globeLayers, mountSessionsList, renderStoryPanel, attachPanZoom, mountTreeSpace, type GlobeControls, type GlobeSurfaces, type GlobeSwitch, type GlobeTarget } from "@storytree/forest/view";
import { workStates } from "@storytree/arc-surface";
import { mountArcSurface } from "@storytree/arc-surface/view";
import { knowledge } from "@storytree/knowledge-core";
import { createKnowledgeCore, KnowledgeNoteCard, type KnowledgeCore } from "@storytree/knowledge-core/view";
import saved from "./forest-snapshot.json" with { type: "json" };
import shopSaved from "./shop-snapshot.json" with { type: "json" };
import ownSaved from "./own-snapshot.json" with { type: "json" };
import { crossingLength, growthPlan, type GrowthPlan } from "@storytree/forest-world/planet";
import { buildPlanetPathways } from "@storytree/forest-world/geometry";
import type { GrowthSnapshot, TourSnapshot } from "./forest-data.js";
import { aim, globeOf, insetAt, islandsKeptOff, labelsAt, labelWords, momentStarts, overlayAt, placeTags, replayMoment, stepAt, switchesFor, type Box, type GlobeOn, type Hold, type Label, type TagSide, type TourDetail, type TourGrowth, type TourStep } from "./tour.js";
import { createCameraPlayer, freePlayFraming, globeSide, viewFraming } from "./tour-camera.js";
import { mapRecording, mapGrowthPlan, recordedFrame } from "./map-recording.js";
import { growthReading, recordedView, savedReading } from "./tour-reading.js";

/** One session's wisp round one island, as the forest draws it: the site's own copy, whole, since it hands each one back (ADR-1017 D2). */
type SessionWisp = { session: string; story: string; colour: string; faded: boolean; capabilities: string[] };

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
    // The globe's drawing sits in the room the list leaves (freeplay.css), so the list's height is the stage's to read. The list
    // renders after mounting, so it is watched for as it arrives.
    const stage = document.getElementById("chapter2"), host = ref.current!;
    let shown: Element | null = null;
    const size = () => stage?.style.setProperty("--tour-sessions", `${Math.ceil(shown?.getBoundingClientRect().height ?? 0)}px`);
    const sized = new ResizeObserver(size);
    const arrive = new MutationObserver(() => {
      const found = host.querySelector(".sessions-list");
      if (found === shown) return;
      if (shown) sized.unobserve(shown);
      shown = found;
      if (shown) sized.observe(shown); else size();
    });
    arrive.observe(host, { childList: true, subtree: true });
    return () => { arrive.disconnect(); sized.disconnect(); stage?.style.removeProperty("--tour-sessions"); stop(); list.stop(); };
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

/** A label on show: what it points at, its words, and whether it is fading out as its line passes. */
type ShownLabel = { key: string; target: GlobeTarget; text: string };
/** How long a label takes to fade, in milliseconds; tour.css's transition matches it. */
const fade = 300;
/**
 * The current line's label on the thing it talks about (2.21), placed on the drawing every frame once the camera has arrived:
 * a ring on a story, capability, file or pathway with its words beside it, clear of the islands it does not point into, their names, the card, the globe's note, the mini globe and the panels. A label that leaves fades out as its line passes.
 */
function Labels({ labels, controls, arrived }: { labels: readonly ShownLabel[]; controls: GlobeControls | undefined; arrived: boolean }) {
  const host = document.getElementById("tour-tags");
  const [shown, setShown] = useState<(ShownLabel & { leaving?: boolean })[]>([]);
  useEffect(() => {
    const keys = new Set(labels.map(label => label.key));
    setShown(before => [...before.filter(label => !keys.has(label.key)).map(label => ({ ...label, leaving: true })), ...labels]);
    const timer = window.setTimeout(() => setShown(before => before.filter(label => keys.has(label.key))), reduced() ? 0 : fade);
    return () => clearTimeout(timer);
  }, [labels]);
  const refs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (!controls || !host || !shown.length) return;
    let frame = 0, previous: TagSide | undefined;
    const place = () => {
      const canvas = document.querySelector("#website-forest canvas")?.getBoundingClientRect(), stage = host.getBoundingClientRect();
      const phone = stage.width <= 600;
      const keepOut = [...document.querySelectorAll("#chapter2 :is(.tour-card, .tour-note, .sessions-list, .arc-overlay, .arc-handle, .story-panel), #website-forest :is(.planet-nameplate:not(.crowded), .planet-mini-globe)")]
        .filter(node => getComputedStyle(node).visibility === "visible").map(node => ({ box: node.getBoundingClientRect(), soft: node.classList.contains("planet-nameplate") }))
        .filter(({ box }) => box.width && box.height)
        .map(({ box, soft }) => ({ x: box.left - stage.left, y: box.top - stage.top, width: box.width, height: box.height, soft }));
      for (const label of shown) {
        const node = refs.current.get(label.key);
        if (!node) continue;
        const at = canvas && arrived && !label.leaving ? controls.position(label.target) : undefined;
        if (!at || !canvas || !at.visible) { node.classList.add("away"); continue; }
        const x = Math.round(at.x + canvas.left - stage.left), y = Math.round(at.y + canvas.top - stage.top);
        node.style.transform = `translate(${x}px, ${y}px)`;
        const words = node.lastElementChild as HTMLElement, size = words.getBoundingClientRect();
        const box: Box = { x, y, width: Math.ceil(size.width), height: Math.ceil(size.height) };
        const islands = islandsKeptOff(controls.islands(), label.target, box, { x: canvas.left - stage.left, y: canvas.top - stage.top });
        const [side] = placeTags([box], { width: stage.width, height: stage.height }, { keepOut: [...keepOut, ...islands], sides: ["right", "left", "below", "above"], previous: phone ? [previous] : [], share: !phone });
        previous = side!.side;
        words.style.left = `${Math.round(side!.x)}px`;
        words.style.top = `${Math.round(side!.y)}px`;
        node.classList.remove("away");
      }
      frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [shown, controls, host, arrived]);
  if (!host) return null;
  return createPortal(<>{shown.map(label => <div key={label.key} ref={node => { if (node) refs.current.set(label.key, node); else refs.current.delete(label.key); }}
    className="tour-tag away" data-label={label.key} data-target={label.target.kind}>
    <span className="tour-tag-ring" /><span className="tour-tag-text">{label.text}</span>
  </div>)}</>, host);
}

/**
 * A part of a panel pointed out while the line or moment that names it is current (2.21): the arcs list's first arc, or the
 * story panel's diagram. An outline round it (`row`, inside the panel `within`) and its words beside it, or below the panel
 * where a phone's full-width list leaves no room beside it; `under` puts them just beneath the outline, inside the panel. It
 * reads the panel's own elements, so it stands with or without the globe.
 */
function PanelPointer({ text, row: rowAt, within, label: name, under = false }: { text: string; row: string; within: string; label: string; under?: boolean }) {
  const outline = useRef<HTMLDivElement>(null), words = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let frame = 0;
    const place = () => {
      const ring = outline.current, label = words.current;
      if (!ring || !label) return;
      const stage = (ring.offsetParent ?? document.body).getBoundingClientRect();
      const row = document.querySelector(rowAt);
      const list = row?.closest(within)?.getBoundingClientRect(), box = row?.getBoundingClientRect();
      const shown = !!box?.width && !!list && box.bottom <= list.bottom + 1;
      ring.classList.toggle("away", !shown);
      if (shown) {
        ring.style.transform = `translate(${Math.round(box.left - stage.left - 3)}px, ${Math.round(box.top - stage.top - 3)}px)`;
        ring.style.width = `${Math.round(box.width + 6)}px`; ring.style.height = `${Math.round(box.height + 6)}px`;
        const size = label.getBoundingClientRect(), beside = !under && box.right + 14 + size.width <= stage.right - 12;
        label.style.left = `${Math.round(beside ? box.width + 20 : 12)}px`;
        label.style.top = `${Math.round(beside ? (box.height + 6 - size.height) / 2 : under ? box.height + 18 : list.bottom - box.top + 14)}px`;
        label.dataset.side = beside ? "beside" : under ? "under" : "below";
      }
      frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [text, rowAt, within]);
  return <div ref={outline} className="tour-arc-pointer away" data-label={name} aria-hidden="true">
    <span ref={words} className="tour-tag-text">{text}</span>
  </div>;
}

/**
 * The inset (ADR-1018 D7, D10): a second live view of the globe on show, close on one island, in the stage's top right, or a
 * full-width card above the caption on a phone (D9). It draws the same frame of the recorded growth as the globe behind it, with
 * the same engine, so the island's parts and then its files arrive as the shop's agents built them, and the current moment's one
 * label points into it. It is watched, not handled: the visitor's hand stays on the globe behind it.
 */
function Inset({ title, target, framing, labels, view }: { title: string; target: GlobeTarget; framing: number; labels: readonly ShownLabel[];
  view: Pick<Parameters<typeof PlanetView>[0], "core" | "scene" | "places" | "frame" | "growth" | "surfaces"> }) {
  const [controls, setControls] = useState<GlobeControls>();
  const host = useRef<HTMLDivElement>(null), tags = useRef(new Map<string, HTMLDivElement>());
  const surfaces = useMemo(() => ({ ...view.surfaces, knowledgeCore: false, nameplates: false }), [view.surfaces]);
  // The island fills the inset as it opens: aimed at again until the frame has drawn it.
  useEffect(() => {
    if (!controls) return;
    let again: ReturnType<typeof setTimeout> | undefined;
    aim(at => controls.stop({ target: at, framing, duration: 0, sideOffset: 0 }), target, target, run => { again = setTimeout(run, 50); });
    return () => clearTimeout(again);
  }, [controls, target, framing]);
  // Each label sits on what it names in the inset, its words centred under the island, or over it near the inset's foot, and
  // kept inside the inset.
  useEffect(() => {
    if (!controls || !labels.length) return;
    let frame = 0;
    const place = () => {
      const box = host.current?.getBoundingClientRect(), island = controls.islands().find(drawn => "story" in target && drawn.story === target.story);
      for (const label of labels) {
        const node = tags.current.get(label.key), at = controls.position(label.target);
        if (!node || !box) continue;
        if (!at?.visible) { node.classList.add("away"); continue; }
        node.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px)`;
        const words = node.lastElementChild as HTMLElement, size = words.getBoundingClientRect();
        words.style.left = `${Math.round(Math.min(Math.max(-size.width / 2, 8 - at.x), box.width - 8 - at.x - size.width))}px`;
        const under = Math.max(26, island ? island.y + island.height + 10 - at.y : 0);
        words.style.top = `${Math.round(at.y + under + size.height <= box.height - 8 ? under : -26 - size.height)}px`;
        node.classList.remove("away");
      }
      frame = requestAnimationFrame(place);
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [controls, labels, target]);
  return <figure className="tour-inset" aria-label={`${title}, up close`}>
    <figcaption className="tour-inset-title">{title}, up close</figcaption>
    <div ref={host} className="tour-inset-view" aria-hidden="true">
      <PlanetView {...view} wisps={[]} selected={undefined} onPick={() => {}} onNote={() => {}} surfaces={surfaces} library={false}
        framing={framing} sideOffset={0} onControls={setControls} />
      {labels.map(label => <div key={label.key} ref={node => { if (node) tags.current.set(label.key, node); else tags.current.delete(label.key); }}
        className="tour-tag away" data-label={label.key} data-target={label.target.kind}>
        <span className="tour-tag-ring" /><span className="tour-tag-text">{label.text}</span>
      </div>)}
    </div>
  </figure>;
}

type ForestHost = { ready(): void; failed(): void; webgl: boolean };
function Forest({ core, recording, replay, finishRecording, ready, failed, webgl }: ForestHost & { core: KnowledgeCore; recording: Recording; replay(): void; finishRecording(): void }) {
  const [tour, setTour] = useState<TourDetail>();
  const [controls, setControls] = useState<GlobeControls>();
  const [wisps, setWisps] = useState<readonly SessionWisp[]>([]);
  const [highlight, setHighlight] = useState<readonly string[]>();
  const [story, setStory] = useState<string>();
  // A story panel the tour opened, not the visitor: its island is not selected, so no ring reads as a claim (ADR-0891, 2026-10-10).
  const [toldStory, setToldStory] = useState<string>();
  const [capability, setCapability] = useState<string>();
  const [note, setNote] = useState<string>();
  // The globe's two switches, Stories and Library, as the app's (ADR-1002 D1); a step sets them, and the website opens with both
  // on where the app opens with Library off.
  const [switches, setSwitches] = useState(() => switchesFor(undefined, true));
  const layers = globeLayers(switches, true);
  const [query, setQuery] = useState("");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [width, setWidth] = useState(window.innerWidth);
  const [arrived, setArrived] = useState(false);
  // No globe draws without WebGL, or once the drawing broke; then no camera puts a step's globe on show (2.16).
  const [broken, setBroken] = useState(false);
  const drawing = webgl && !broken;
  const globeFailed = useCallback(() => { setBroken(true); failed(); }, [failed]);
  // Each growth's own knowledge core, its notes appearing as the time-lapse reaches their dates (knowledge core 1.9). A public
  // recording holds no transcript windows, so a session the core follows is drawn by its recorded reading path (ADR-0756).
  const growthCores = useMemo(() => Object.fromEntries((Object.keys(growths) as Grown[]).map(map => {
    const made = createKnowledgeCore(growths[map].snapshot.project, { reads: { windowReading: async (_project, session) =>
      ({ session, at: growths[map].snapshot.window.to, absent: "Transcript windows were not included in this public recording." }) } });
    made.take(growths[map].snapshot.changes ?? [], []); return [map, made];
  })) as Record<Grown, KnowledgeCore>, []);
  useEffect(() => () => Object.values(growthCores).forEach(made => made.dispose()), [growthCores]);
  // The shop's saved reading, at rest at its end, for free play on the shop (2.14).
  const shopView = useMemo(() => shopSnapshot && { recording: savedReading(shopSnapshot) }, []);
  useEffect(() => () => shopView?.recording.reading.stop(), [shopView]);
  // Where the arrival's time-lapse stands: told every frame by the tour while it plays (ADR-0889 2.2).
  const [growthAt, setGrowthAt] = useState<TourGrowth>();
  useEffect(() => {
    const hear = (event: CustomEvent<TourGrowth>) => setGrowthAt(event.detail);
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
  const [camera] = useState(() => createCameraPlayer({ timers: { set: (run, ms) => window.setTimeout(run, ms), clear: timer => clearTimeout(timer as number) },
    arrived: setArrived, running: () => latest.current?.running === true }));
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
  const surfaces = useMemo((): Partial<GlobeSurfaces> => {
    if (!step || free || everything) return complete;
    let shown = step.surfaces;
    for (const [from, next] of Object.entries(step.lineSurfaces ?? {})) if ((state?.moments ?? 1) >= Number(from)) shown = next;
    return shown;
  }, [step, state?.moments, free, everything]);
  // The step as its told lines and moments leave it: one can move the camera, or give its panel way to another (ADR-0891, amended 2026-10-11).
  const shownStep = step && stepAt(step, state?.moments ?? 1);
  const requestedPanel = touring && !everything && (state?.moments ?? 1) >= (step?.panelFromLine ?? 1) ? shownStep?.panel : undefined;
  // The one overlay on show, and its corner (ADR-1018 D7, D9): the stage carries it, so the panel on show takes the corner's place.
  const overlay = touring && !everything && step ? overlayAt(step, state?.moments ?? 1) : undefined;
  useEffect(() => {
    if (!panelHost) return;
    if (overlay) { panelHost.dataset.overlay = overlay.corner; panelHost.dataset.overlayPanel = overlay.panel; }
    else { delete panelHost.dataset.overlay; delete panelHost.dataset.overlayPanel; }
  }, [panelHost, overlay?.corner, overlay?.panel]);
  const sideOffset = globeSide(touring && !everything ? shownStep : undefined, width);
  const globe: GlobeOn = step && state ? globeOf(step, state, tour!.elapsed) : { map: "storytree" };

  // Touching the globe hands it to the visitor: the tour waits, and says so (ADR-0879 D3).
  const explore = useCallback(() => { if (touring) { controls?.cancel(); camera.cancel(); hold("exploring"); } }, [touring, controls, camera]);
  const pickStory = useCallback((id: string | undefined, picked?: string) => {
    explore(); setStory(id); setToldStory(undefined); setCapability(picked); setNote(undefined); core.pin(undefined);
  }, [core, explore]);
  const pickCapability = useCallback((id: string) => { explore(); setCapability(id); }, [explore]);
  const closeStory = useCallback(() => { setStory(undefined); setCapability(undefined); }, []);
  const pickNote = useCallback((id: string) => { explore(); setNote(id); setStory(undefined); activeCore.pin(id); }, [activeCore, explore]);
  const closeNote = useCallback(() => { setNote(undefined); activeCore.pin(undefined); }, [activeCore]);
  // A switch turned off closes the panel it would leave pointing at nothing: Stories a story's, Library a note's card.
  const flip = (which: GlobeSwitch) => {
    const next = flipSwitch(switches, which);
    setSwitches(next);
    if (!next.stories) { closeStory(); setToldStory(undefined); }
    if (!next.library) closeNote();
  };
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
    const hear = (event: CustomEvent<TourDetail>) => {
      const detail = event.detail;
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
    const inSessions = !free && step?.panel === "sessions" && !step.sessionsAt;
    const wasInSessions = before?.inSessions === true && before.generation === state!.generation;
    recordingAt.current = { inSessions, generation: state!.generation };
    if (inSessions && !wasInSessions) replay();
    else if (!inSessions && before && (before.inSessions || before.generation !== state!.generation)) finishRecording();
  }, [step?.id, state?.generation, free]);
  useEffect(() => {
    const opening = (event: CustomEvent<{ active: boolean }>) => {
      const active = event.detail.active;
      // The first view waits for chapter 1 to hand over, so it grows in where the visitor is looking.
      if (active) camera.reenter();
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
    setSwitches(switchesFor(requestedPanel, false));
    setBrowserOpen(false);
    // A phone has no room for a note's card beside the card: the step says it in words instead. The story panel is an overlay,
    // a full-width card above the caption on a phone (ADR-1018 D9).
    const told = requestedPanel === "note" && window.innerWidth > 600 ? step?.note : undefined;
    setNote(told); activeCore.pin(told);
    // A step whose inset showed an island opens that island's panel once the inset has played.
    const island = step?.inset?.target ?? step?.target;
    if (requestedPanel === "story") { setStory(ownerOf(island)); setToldStory(ownerOf(island)); setCapability(island?.kind === "capability" ? island.capability : undefined); }
    else { setStory(undefined); setCapability(undefined); }
    // The shop's core draws the reads of the session the step follows, and no one's elsewhere (ADR-0921).
    growthCores.shop.select(step?.map === "shop" ? step.follow : undefined);
  };
  useEffect(openStepSurfaces, [step?.id, state?.generation, free, everything, requestedPanel]);
  // Resuming after exploring closes what the visitor opened and puts the step's own surfaces back.
  const exploringNow = state?.holds.includes("exploring") === true;
  useEffect(() => {
    if (wasExploring.current && !exploringNow) openStepSurfaces();
    wasExploring.current = exploringNow;
  }, [exploringNow]);

  // The camera flies; it never snaps (ADR-0879 D5). Between close steps it stays in and turns the globe (2.15). Its cues and
  // timers are the camera player's (tour-camera.ts): the page tells it each step and puts on show the globe it asks for.
  useEffect(() => {
    if (!tour || !controls || free || !step || openingActive) return;
    const before = previous.current;
    previous.current = tour;
    if (exploringNow || everything) { camera.freeze(); if (everything && shownMapNow.current !== "storytree") setShownMap("storytree"); return; }
    const map = globe.map, overview = overviews[map];
    const view = (width > 600 ? shownStep!.laptop : shownStep!.phone) ?? shownStep!;
    const target = view.target ?? overview;
    camera.step({ tour, before, switching: map !== shownMapNow.current, to: { target, framing: viewFraming(shownStep!, width, restingFraming) }, overview,
      shownOverview: overviews[shownMapNow.current], driftOrder: driftOrders[map], next: driftOrders[map].indexOf(ownerOf(target) ?? "") + 1,
      reduced: reduced(), place: stop => controls.stop({ ...stop, sideOffset }), show: () => setShownMap(map) });
  }, [controls, tour, sideOffset, openingActive, globe.map]);
  // With no globe drawn, each step's panels read the step's own project directly, as the camera would have shown it (2.16).
  useEffect(() => {
    if (!tour || drawing || free || !step) return;
    const map = everything ? "storytree" : globe.map;
    if (shownMapNow.current !== map) setShownMap(map);
  }, [tour, drawing, free, everything, globe.map]);
  // Once a swapped globe is drawn, the camera dives into it.
  useEffect(() => {
    if (!camera.diving) return;
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => camera.drawn()); });
    return () => cancelAnimationFrame(frame);
  }, [shownMap]);
  // Free play shows the project its selector chose (ADR-0890): the whole shop, or storytree's own. A switch closes what
  // the visitor had open on the other and frames the new globe whole.
  useEffect(() => {
    if (!free || shownMap === globe.map) return;
    setStory(undefined); setCapability(undefined); setNote(undefined); setBrowserOpen(false);
    setShownMap(globe.map);
  }, [free, globe.map, shownMap]);
  useEffect(() => { if (free) setSwitches(switchesFor(undefined, true)); }, [free]);
  useEffect(() => {
    if (!free || !controls) return;
    // Free play takes the camera from the tour: a drift the last step left running would otherwise keep turning and framing it.
    camera.cancel();
    // A globe just swapped in may not be drawn yet (storytree's takes seconds with software WebGL): it is aimed at again, for up to
    // 20 seconds, until it is, so the last globe's framing does not stay.
    let again: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => aim(target => controls.stop({ target, framing: freePlayFraming(shownMap, width, restingFraming), duration: reduced() ? 0 : 1200, sideOffset: 0 }),
      overviews[shownMap], overviews[shownMap], run => { again = setTimeout(run, 50); }, 400));
    return () => { cancelAnimationFrame(frame); clearTimeout(again); };
  }, [free, shownMap, controls]);
  useEffect(() => () => camera.cancel(), [camera]);

  // Find reads the project on show: its islands and its notes.
  const shownNotes = (grows(shownMap) ? [...knowledge(growths[shownMap].snapshot.changes ?? []).notes.values()] : notes).filter(item => String(item.fields.title ?? "").toLowerCase().includes(query.toLowerCase()));
  const selected = (story !== toldStory ? story : undefined) ?? (touring && !everything ? step?.select : undefined);
  const onStorytree = shownMap === "storytree";
  // The knowledge chapter stays on the globe the map chapter leaves: the first round's four stories at its 03:08:57 survey, at
  // their own plan's places; leaving them for the whole shop eases the four across to its places, once (3.4, forest 3.28).
  const inMapChapter = touring && !everything && (step?.explainer === "map" || step?.explainer === "knowledge") && shownMap === "shop";
  const grown = inMapChapter ? mapChapter : grows(shownMap) ? growths[shownMap] : undefined;
  // The tour's step says how far the growth has played (seconds at 1×), over the whole plan or one stage of it (2.16).
  // Undefined is whole; a held seed is the point the globe grows from.
  let moment: number | undefined;
  if (grown && globe.map === shownMap && "at" in globe && globe.at !== undefined) {
    const told = growthAt && growthAt.index === state?.index && growthAt.generation === state?.generation ? growthAt.at : globe.at;
    moment = typeof step?.growth === "object" ? replayMoment(grown.plan(), step.growth, told, momentStarts(step)) : 0;
  }
  const growth = grown ? { plan: grown.plan(), at: moment ?? Infinity } : undefined;
  // A step narrowed to a few stories dims the rest (ADR-0890's three teaching stories).
  const focus = touring && !everything && globe.map === shownMap && "focus" in globe ? globe.focus : undefined;
  const mapFrame = grown && moment !== undefined && inMapChapter ? recordedFrame(grown.snapshot, grown.plan(), moment) : undefined;
  const drawn = mapFrame?.scene ?? grown?.snapshot.scene ?? snapshot.scene;
  // Free play on the shop reads the shop's saved reading for its panels, arcs and sessions; everywhere else, storytree's.
  const onShop = free && shownMap === "shop" && shopView !== undefined;
  // A step replaying the shop's growth can still read its sessions list and its arcs at one recorded moment.
  const sessionsAt = touring && !everything && shownMap === "shop" ? step?.sessionsAt : undefined;
  const shopAt = useMemo(() => sessionsAt && shopSnapshot ? { recording: savedReading(shopSnapshot, { until: sessionsAt }) } : undefined, [sessionsAt]);
  useEffect(() => () => shopAt?.recording.reading.stop(), [shopAt]);
  // The current line's or moment's labels, their words read from the frame on show: a session is named as it had named itself by
  // then (2.21). A waiting step shows every label its last line brings.
  const still = (state?.holds.length ?? 0) > 0;
  // While the step's inset plays, its moment's label points into the inset, not the globe behind it (2.28).
  const inset = inMapChapter && mapFrame && step && state && overlay?.panel === "inset" ? insetAt(step, state.moments, { width, still }) : undefined;
  const lineLabels = inMapChapter && mapFrame && step && state && !inset ? labelsAt(step, state.moments, { width, still }) : [];
  const named = (session: string) => shop.reading?.recording.lines.filter(line => line.kind === "session-named" && line.session === session && line.at <= mapFrame!.at).flatMap(line => "title" in line ? [String(line.title)] : []).at(-1);
  const keyed = (labels: readonly Label[]) => JSON.stringify(labels.flatMap(label => {
    if ("point" in label) return [];
    const text = labelWords(label, mapFrame!, named);
    return text ? [{ key: `${step!.id}:${JSON.stringify(label.target)}:${text}`, target: label.target, text }] : [];
  }));
  const labelKey = keyed(lineLabels), insetKey = inset ? keyed(inset.labels) : "[]";
  const shownLabels = useMemo((): ShownLabel[] => JSON.parse(labelKey), [labelKey]);
  const insetLabels = useMemo((): ShownLabel[] => JSON.parse(insetKey), [insetKey]);
  // The sessions list is pointed out while the line that names it is said, not labelled on the globe.
  const pointed = lineLabels.some(label => "point" in label && label.point === "sessions");
  // The arcs list's first arc is pointed out and named while the line that names it is said, with or without the globe.
  const pointAt = (point: "arc" | "panel") => touring && !everything && step && state
    ? labelsAt(step, state.moments, { width, still }).flatMap(label => "point" in label && label.point === point ? [label.text] : [])[0] : undefined;
  const arcPoint = requestedPanel === "arcs" ? pointAt("arc") : undefined;
  // The story panel's diagram is pointed out and named as the moment that opens it arrives.
  const panelPoint = requestedPanel === "story" ? pointAt("panel") : undefined;
  // The knowledge chapter's flags are the claims its sessions list reads at its moment, past the map chapter's first round.
  const heldClaims = inMapChapter && step?.explainer === "knowledge" && shopAt !== undefined;
  const panelReading = onStorytree ? snapshot : shownMap === "shop" ? shopSnapshot : undefined;
  const shownProgress = onShop ? shopView.recording.progress() : shopAt ? shopAt.recording.progress() : progress;
  // While the shop's sessions are on show, its core hears their recorded reads, as storytree's core hears its own: in free play
  // to the recording's end, and on a step to the moment it reads.
  useEffect(() => {
    const heard = onShop ? shopView.recording : shopAt?.recording;
    if (!heard) return;
    return heard.reading.subscribe({ onNews: news => growthCores.shop.take(shop.changes ?? [], news.lines) });
  }, [onShop, shopView, shopAt, growthCores]);
  return <>
    {webgl && tour && <GlobeBoundary failed={globeFailed}>
      <div className="forest-drawing" role="group" aria-label={onStorytree ? "Storytree’s saved project globe" : shownMap === "own" ? "Storytree’s own globe, growing as its agents built it" : "An online shop’s globe, as its agents built it"}
        data-globe={shownMap} data-globe-shown={layers.shown} style={layers.shown ? undefined : { visibility: "hidden" }} data-arrived={arrived} data-growth={grown ? moment === undefined ? "whole" : moment.toFixed(2) : undefined} data-focus={focus?.join(" ")}
        data-islands={drawn.islands.length} data-risen={growth ? [...growth.plan.islands.values()].filter(window => window.start <= growth.at).length : undefined} onPointerDown={explore} onWheel={explore}>
        <PlanetView core={grown ? growthCores[shownMap as Grown] : core} scene={drawn} places={grown?.places ?? places}
          frame={grown?.snapshot.scene} easeMoves growth={growth} recordedSessions={mapFrame || (shopAt && shownMap === "shop") ? undefined : grown?.sessions}
          wisps={(heldClaims ? wisps : mapFrame?.wisps) ?? (shopAt && shownMap === "shop" ? wisps : grown ? [] : wisps)} selected={selected}
          highlighted={focus?.length === 0 ? ["planned-only"] : focus ?? highlight} onPick={pickStory} onNote={pickNote}
          onControls={onControls} surfaces={surfaces} framing={free ? freePlayFraming(shownMap, width, restingFraming) : restingFraming} sideOffset={globeSide(undefined, width)} mode={layers.mode} library={layers.library} />
      </div>
    </GlobeBoundary>}
    {webgl && <Labels labels={shownLabels} controls={controls} arrived={arrived} />}
    {panelHost && createPortal(<>
      <div className="forest-views" role="group" aria-label="Globe layers" hidden={!free}>
        {layers.offered.map(which => <button key={which} type="button" data-globe-switch={which} aria-pressed={switches[which]} onClick={() => flip(which)}>
          {which === "stories" ? "Stories" : "Library"}
        </button>)}
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
      <div className="tour-session-surface" data-pointed={pointed || undefined} hidden={free ? !onStorytree && !onShop : requestedPanel !== "sessions"}>
        {shopAt
          ? <Sessions key={`shop@${sessionsAt}`} project={shop.project} recording={shopAt.recording} core={growthCores.shop} onWisps={setWisps} onHighlight={onHighlight} onPick={explore} />
          : onShop
          ? <Sessions key="shop" project={shop.project} recording={shopView.recording} core={growthCores.shop} onWisps={setWisps} onHighlight={onHighlight} onPick={explore} />
          : <Sessions key="storytree" project={snapshot.project} recording={recording} core={core} onWisps={setWisps} onHighlight={onHighlight} onPick={explore} />}
        <p className="tour-recording-progress" data-recording-index={shownProgress.index} data-recording-total={shownProgress.total}>
          Recording · <time dateTime={shownProgress.at}>{shownProgress.at.slice(11, 16)} UTC</time> · {shownProgress.index} of {shownProgress.total} events
        </p>
      </div>
      <div className="tour-arc-surface" hidden={free ? !onStorytree && !onShop : requestedPanel !== "arcs"}>
        {shopAt
          ? <Arcs key={`shop@${sessionsAt}`} project={shop.project} recording={shopAt.recording} open={requestedPanel === "arcs"} />
          : onShop
          ? <Arcs key="shop" project={shop.project} recording={shopView.recording} open={false} />
          : <Arcs key="storytree" project={snapshot.project} recording={recording} open={requestedPanel === "arcs"} />}
      </div>
      {inset && grown && drawing && <Inset key={`${step!.id}:${state!.generation}`} title={shop.titles[ownerOf(inset.target) ?? ""] ?? "A story"} target={inset.target} framing={inset.framing} labels={insetLabels}
        view={{ core: growthCores.shop, scene: drawn, places: grown.places, frame: grown.snapshot.scene, growth, surfaces }} />}
      {arcPoint && <PanelPointer key={arcPoint} text={arcPoint} row="#chapter2 .tour-arc-surface:not([hidden]) .arc-overlay:not([hidden]) .arc-lane" within=".arc-overlay" label="arc" />}
      {panelPoint && <PanelPointer key={panelPoint} text={panelPoint} row="#chapter2 .tour-story-panel .panel-tree-frame" within=".tour-story-panel" label="panel" under />}
    </>, panelHost)}
  </>;
}

function RecordedForest(props: ForestHost) {
  const [view, setView] = useState(() => recordedView(snapshot));
  useEffect(() => () => view.stop(), [view]);
  const replay = useCallback(() => setView(recordedView(snapshot, { replay: true })), []);
  const finishRecording = useCallback(() => setView(recordedView(snapshot)), []);
  return <Forest {...props} core={view.core} recording={view.recording} replay={replay} finishRecording={finishRecording} />;
}

export function mountForest(host: HTMLElement, ready: () => void, failed: () => void, webgl = true): () => void {
  const root = createRoot(host);
  root.render(<RecordedForest ready={ready} failed={failed} webgl={webgl} />);
  const lost = () => failed();
  host.addEventListener("webglcontextlost", lost, true);
  return () => { host.removeEventListener("webglcontextlost", lost, true); root.unmount(); };
}

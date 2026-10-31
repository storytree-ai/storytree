/** Capability 2 · The forest on the site. Storytree's own map in free play, inside the frame at the top of the page (ADR-1091 D1 (2)). */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { drillDown } from "@storytree/forest";
import { PlanetView, flipSwitch, globeLayers, mountSessionsList, renderStoryPanel, attachPanZoom, mountTreeSpace, type GlobeControls, type GlobeSurfaces, type GlobeSwitch, type GlobeSwitches, type GlobeTarget } from "@storytree/forest/view";
import { workStates } from "@storytree/arc-surface";
import { mountArcSurface } from "@storytree/arc-surface/view";
import { knowledge } from "@storytree/knowledge-core";
import { KnowledgeNoteCard, type KnowledgeCore } from "@storytree/knowledge-core/view";
import saved from "./forest-snapshot.json" with { type: "json" };
import { SHEET_RADIUS } from "@storytree/forest-world/planet";
import type { TourSnapshot } from "./forest-data.js";
import { recordedView, savedReading } from "./tour-reading.js";
import { wireMapFrame } from "./map-frame.js";
import { arrivalGrowth } from "./arrival-growth.js";

/** One session's wisp round one island, as the forest draws it: the site's own copy, whole, since it hands each one back (ADR-1017 D2). */
type SessionWisp = { session: string; story: string; colour: string; faded: boolean; capabilities: string[] };

const snapshot = saved as unknown as TourSnapshot;
const places = new Map(snapshot.places.map(place => [place.id, place.place]));
const notes = [...knowledge(snapshot.changes).notes.values()];
const complete: GlobeSurfaces = { grounds: true, roads: true, nameplates: true, territories: "health", fileCircles: true, knowledgeCore: true, sessionTints: true };
/** The map's whole view: on the glass sheet, the view it opens on (forest 3.66). */
const overview: GlobeTarget = { kind: "core" };
/** The map frames itself in the glass sheet's ground units (the short half-side of the view); the sheet's camera takes them in its sphere's radii. */
const sheetFraming = (ground: number) => ground / SHEET_RADIUS;
/**
 * Storytree's own sheet framed whole, in ground units, by the frame's width: on a laptop clear of the sessions list, and on a
 * phone wider, since its frame is narrower than the sheet, wider still toward 320px so the names it shows stay inside.
 */
export function mapFraming(width: number): number {
  if (width > 600) return 520;
  return 1020 + 80 * Math.min(1, Math.max(0, (390 - width) / 70));
}
/** Free play opens with both of the map's switches on, as the app's own front page does not (ADR-1002 D1). */
const opening: GlobeSwitches = { stories: true, library: true };
/** On arrival the map draws itself inside the frame, then stands whole for free play (2.32); the canvas keeps its clock. */
const arrival = { plan: arrivalGrowth(snapshot) };
type Recording = ReturnType<typeof savedReading>;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
/** The frame every panel sits inside. */
const frameOf = () => document.querySelector<HTMLElement>("#map-frame");

/** A lost graphics context leaves the saved picture and the readable app surfaces available. */
class GlobeBoundary extends Component<{ children: ReactNode; failed(): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.failed(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function StoryDetails({ story, capability, choose, close }: { story: string; capability: string | undefined; choose(id: string): void; close(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const panel = useMemo(() => drillDown(snapshot.tree, story, workStates(snapshot.recording.lines as Recording["lines"]), snapshot.changes), [story]);
  useEffect(() => {
    const host = ref.current, frame = frameOf();
    if (!host || !panel || !frame) return;
    host.innerHTML = renderStoryPanel(panel, capability);
    const tree = host.querySelector<HTMLElement>(".panel-tree-frame");
    const surface = host.querySelector<HTMLElement>(".panel-tree-surface");
    const moving = tree && surface ? attachPanZoom(tree, surface, choose) : undefined;
    moving?.open();
    const large = mountTreeSpace(frame, { choose, closed() {} });
    host.querySelector("[data-open-tree]")?.addEventListener("click", () => large.show(panel, capability));
    host.querySelector(".panel-close")?.addEventListener("click", close);
    return () => { moving?.stop(); large.stop(); };
  }, [panel, capability, choose, close]);
  return <div ref={ref} className="story-panel map-story-panel" data-story-id={story} />;
}

function Sessions({ recording, core, onWisps, onHighlight }: { recording: Recording; core: KnowledgeCore; onWisps(wisps: readonly SessionWisp[]): void; onHighlight(stories: readonly string[] | undefined): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = mountSessionsList(ref.current!, { project: snapshot.project, reads: recording.reads,
      reading: recording.reading, now: recording.now, onWisps, onHighlight,
      onRoster: roster => core.showRoster(roster), onSelect: session => core.select(session) });
    const stop = core.onSelect(session => list.select(session));
    // The map's drawing sits in the room the list leaves (freeplay.css), so the list's height is the frame's to read. The list
    // renders after mounting, so it is watched for as it arrives.
    const frame = frameOf(), host = ref.current!;
    let shown: Element | null = null;
    const size = () => frame?.style.setProperty("--map-sessions", `${Math.ceil(shown?.getBoundingClientRect().height ?? 0)}px`);
    const sized = new ResizeObserver(size);
    const arrive = new MutationObserver(() => {
      const found = host.querySelector(".sessions-list");
      if (found === shown) return;
      if (shown) sized.unobserve(shown);
      shown = found;
      if (shown) sized.observe(shown); else size();
    });
    arrive.observe(host, { childList: true, subtree: true });
    return () => { arrive.disconnect(); sized.disconnect(); frame?.style.removeProperty("--map-sessions"); stop(); list.stop(); };
  }, [recording, core, onWisps, onHighlight]);
  return <div ref={ref} className="map-sessions" />;
}

function Arcs({ recording }: { recording: Recording }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mounted = mountArcSurface(ref.current!, { project: snapshot.project, reads: recording.reads, timers: recording.timers, reading: recording.reading });
    return () => mounted.stop();
  }, [recording]);
  return <div ref={ref} className="map-arcs" />;
}

type ForestHost = { ready(): void; failed(): void; webgl: boolean };
function Forest({ ready, failed, webgl }: ForestHost) {
  const [view] = useState(() => recordedView(snapshot));
  useEffect(() => () => view.stop(), [view]);
  const { core, recording } = view;
  const [controls, setControls] = useState<GlobeControls>();
  const [wisps, setWisps] = useState<readonly SessionWisp[]>([]);
  const [highlight, setHighlight] = useState<readonly string[]>();
  const [story, setStory] = useState<string>();
  const [capability, setCapability] = useState<string>();
  const [note, setNote] = useState<string>();
  const [switches, setSwitches] = useState(opening);
  const layers = globeLayers(switches, true);
  const [query, setQuery] = useState("");
  const [browserOpen, setBrowserOpen] = useState(false);
  const frame = frameOf();
  const [width, setWidth] = useState(() => frame?.clientWidth ?? window.innerWidth);
  useEffect(() => {
    if (!frame) return;
    const resized = new ResizeObserver(() => setWidth(frame.clientWidth));
    resized.observe(frame);
    return () => resized.disconnect();
  }, [frame]);
  // No map draws without WebGL, or once the drawing broke; the saved still shows instead (2.2).
  const [broken, setBroken] = useState(false);
  const globeFailed = useCallback(() => { setBroken(true); failed(); }, [failed]);

  const pickStory = useCallback((id: string | undefined, picked?: string) => {
    setStory(id); setCapability(picked); setNote(undefined); core.pin(undefined);
  }, [core]);
  const pickCapability = useCallback((id: string) => setCapability(id), []);
  const closeStory = useCallback(() => { setStory(undefined); setCapability(undefined); }, []);
  const pickNote = useCallback((id: string) => { setNote(id); setStory(undefined); core.pin(id); }, [core]);
  const closeNote = useCallback(() => { setNote(undefined); core.pin(undefined); }, [core]);
  // A switch turned off closes the panel it would leave pointing at nothing: Stories a story's, Library a note's card.
  const flip = (which: GlobeSwitch) => {
    const next = flipSwitch(switches, which);
    setSwitches(next);
    if (!next.stories) closeStory();
    if (!next.library) closeNote();
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key !== "Escape" || event.defaultPrevented) return; if (note) closeNote(); else if (story) closeStory(); else setBrowserOpen(false); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [note, story, closeNote, closeStory]);
  const onHighlight = useCallback((stories: readonly string[] | undefined) => setHighlight(stories), []);
  const onControls = useCallback((next: GlobeControls | undefined) => setControls(next), []);
  useEffect(() => {
    if (!controls) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(ready));
    return () => cancelAnimationFrame(frame);
  }, [controls, ready]);
  // The map opens framed whole; a sheet that is not drawn yet is aimed at again, for up to 20 seconds, until it is.
  useEffect(() => {
    if (!controls) return;
    let again: ReturnType<typeof setTimeout> | undefined, tries = 400;
    const aim = () => {
      if (controls.stop({ target: overview, framing: sheetFraming(mapFraming(width)), duration: reduced() ? 0 : 1200, sideOffset: 0 }) || tries-- <= 0) return;
      again = setTimeout(aim, 50);
    };
    const frame = requestAnimationFrame(aim);
    return () => { cancelAnimationFrame(frame); clearTimeout(again); };
  }, [controls]);

  // Find reads the map's islands and its notes.
  const shownNotes = notes.filter(item => String(item.fields.title ?? "").toLowerCase().includes(query.toLowerCase()));
  return <>
    {webgl && !broken && <GlobeBoundary failed={globeFailed}>
      <div className="forest-drawing" role="group" aria-label="Storytree’s saved project map" data-globe="storytree" data-globe-shown={layers.shown}
        style={layers.shown ? undefined : { visibility: "hidden" }} data-islands={snapshot.scene.islands.length}>
        <PlanetView core={core} scene={snapshot.scene} places={places} wisps={wisps} selected={story} highlighted={highlight}
          onPick={pickStory} onNote={pickNote} onControls={onControls} surfaces={complete} framing={sheetFraming(mapFraming(width))} sideOffset={0}
          mode={layers.mode} library={layers.library} growth={arrival} />
      </div>
    </GlobeBoundary>}
    {frame && createPortal(<>
      <div className="forest-views" role="group" aria-label="Map layers">
        {layers.offered.map(which => <button key={which} type="button" data-globe-switch={which} aria-pressed={switches[which]} onClick={() => flip(which)}>
          {which === "stories" ? "Stories" : "Library"}
        </button>)}
      </div>
      <button className="map-browse-toggle" type="button" aria-label="Find a story or note in the saved project" aria-expanded={browserOpen} onClick={() => setBrowserOpen(value => !value)}>Find</button>
      <div className="map-record-browser" hidden={!browserOpen}>
        <header><h2>Saved project</h2><button type="button" aria-label="Close project browser" onClick={() => setBrowserOpen(false)}>×</button></header>
        <p className="map-recorded-label">{`Saved ${snapshot.capturedAt.slice(0, 10)}`} · read only</p>
        <label htmlFor="map-story-choice">Open a story</label>
        <select id="map-story-choice" value={story ?? ""} onChange={event => { pickStory(event.target.value); controls?.stop({ target: { kind: "story", story: event.target.value }, framing: sheetFraming(130), duration: reduced() ? 0 : 1400 }); setBrowserOpen(false); }}>
          <option value="" disabled>Choose an island…</option>
          {snapshot.tree.stories.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <div className="map-knowledge" onKeyDown={event => {
          if (event.key !== "Escape" || !note) return;
          event.preventDefault(); event.stopPropagation(); closeNote();
          document.getElementById("map-note-choice")?.focus();
        }}>
          <label htmlFor="map-note-search">Find a note in the library</label>
          <input id="map-note-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search decisions and guidance" />
          <label htmlFor="map-note-choice">Library note</label>
          <select id="map-note-choice" value={note ?? ""} onChange={event => { pickNote(event.target.value); setBrowserOpen(false); }}>
            <option value="" disabled>Choose a note…</option>
            {shownNotes.map(item => <option key={item.id} value={item.id}>{String(item.fields.title ?? item.id)}</option>)}
          </select>
          {shownNotes.length === 0 && <p>No saved notes match that search.</p>}
        </div>
      </div>
      {story && snapshot.tree.stories.some(item => item.id === story) && <StoryDetails story={story} capability={capability} choose={pickCapability} close={closeStory} />}
      {note && <div className="story-panel" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); closeNote(); } }}><KnowledgeNoteCard core={core} onClose={closeNote} /></div>}
      {/* Storytree's own recorded sessions and its arcs, at rest at the recording's end. */}
      <div className="map-session-surface"><Sessions recording={recording} core={core} onWisps={setWisps} onHighlight={onHighlight} /></div>
      <div className="map-arc-surface"><Arcs recording={recording} /></div>
    </>, frame)}
  </>;
}

export function mountForest(host: HTMLElement, ready: () => void, failed: () => void, webgl = true): () => void {
  // The frame keeps the page's scroll and keys from the map from the moment there is a map to take them (2.30, 2.31).
  const frame = frameOf(), unframe = frame ? wireMapFrame(frame) : undefined;
  const root = createRoot(host);
  root.render(<Forest ready={ready} failed={failed} webgl={webgl} />);
  const lost = () => failed();
  host.addEventListener("webglcontextlost", lost, true);
  return () => { host.removeEventListener("webglcontextlost", lost, true); root.unmount(); unframe?.(); };
}

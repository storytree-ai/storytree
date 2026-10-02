import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { drillDown, type SessionWisp } from "@storytree/forest";
import { PlanetView, mountSessionsList, renderStoryPanel, attachPanZoom, mountTreeSpace, type CameraStop, type GlobeControls, type GlobeSurfaces } from "@storytree/forest/view";
import { workStates } from "@storytree/arc-surface";
import { mountArcSurface } from "@storytree/arc-surface/view";
import { knowledge } from "@storytree/knowledge-core";
import { createKnowledgeCore, KnowledgeNoteCard, type KnowledgeCore } from "@storytree/knowledge-core/view";
import saved from "./forest-snapshot.json" with { type: "json" };
import type { TourSnapshot } from "./forest-data.js";
import type { TourState, TourStep } from "./tour.js";
import { savedReading } from "./tour-reading.js";

const snapshot = saved as unknown as TourSnapshot;
const places = new Map(snapshot.places.map(place => [place.id, place.place]));
const notes = [...knowledge(snapshot.changes).notes.values()];
const complete: GlobeSurfaces = { sea: true, grounds: true, roads: true, nameplates: true, territories: "health", fileCircles: true, knowledgeCore: true, sessionTints: true };
type Tour = { step: TourStep; state: TourState };
type Recording = ReturnType<typeof savedReading>;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const interact = () => window.dispatchEvent(new Event("storytree-tour-interact"));

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
    const host = ref.current;
    if (!host || !panel) return;
    host.innerHTML = renderStoryPanel(panel, capability);
    const frame = host.querySelector<HTMLElement>(".panel-tree-frame");
    const surface = host.querySelector<HTMLElement>(".panel-tree-surface");
    const moving = frame && surface ? attachPanZoom(frame, surface, choose) : undefined;
    moving?.open();
    const large = mountTreeSpace(host, { choose, closed() {} });
    host.querySelector("[data-open-tree]")?.addEventListener("click", () => large.show(panel, capability));
    host.querySelector(".panel-close")?.addEventListener("click", close);
    return () => { moving?.stop(); large.stop(); };
  }, [panel, capability, choose, close]);
  return <div ref={ref} className="tour-story-panel" data-story-id={story} />;
}

function Sessions({ recording, core, onWisps, onHighlight }: { recording: Recording; core: KnowledgeCore; onWisps(wisps: readonly SessionWisp[]): void; onHighlight(stories: readonly string[] | undefined, session?: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = mountSessionsList(ref.current!, { project: snapshot.project, reads: recording.reads,
      reading: recording.reading, now: recording.now, onWisps, onHighlight,
      onRoster: roster => core.showRoster(roster), onSelect: session => { interact(); core.select(session); } });
    const stop = core.onSelect(session => list.select(session));
    return () => { stop(); list.stop(); };
  }, [recording, core, onWisps, onHighlight]);
  return <div ref={ref} className="tour-sessions" />;
}

function Arcs({ recording, open }: { recording: Recording; open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useRef<ReturnType<typeof mountArcSurface>>(undefined);
  useEffect(() => {
    mounted.current = mountArcSurface(ref.current!, { project: snapshot.project, reads: recording.reads, timers: recording.timers, reading: recording.reading });
    return () => { mounted.current?.stop(); mounted.current = undefined; };
  }, [recording]);
  useEffect(() => { if (open) mounted.current?.open(); else mounted.current?.close(); }, [open]);
  return <div ref={ref} className="tour-arcs" />;
}

type ForestHost = { ready(): void; failed(): void; webgl: boolean };
function Forest({ core, recording, replay, finishRecording, ready, failed, webgl }: ForestHost & { core: KnowledgeCore; recording: Recording; replay(): void; finishRecording(): void }) {
  const [tour, setTour] = useState<Tour>();
  const [controls, setControls] = useState<GlobeControls>();
  const [wisps, setWisps] = useState<readonly SessionWisp[]>([]);
  const [highlight, setHighlight] = useState<{ stories: readonly string[] | undefined; session: string | undefined }>({ stories: undefined, session: undefined });
  const [story, setStory] = useState<string>();
  const [capability, setCapability] = useState<string>();
  const [note, setNote] = useState<string>();
  const [mode, setMode] = useState<"forest" | "library">("forest");
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [userStop, setUserStop] = useState<CameraStop>();
  const [progress, setProgress] = useState(recording.progress);
  const previousStep = useRef<string | undefined>(undefined);
  const previousGeneration = useRef<number | undefined>(undefined);
  const panelHost = document.querySelector<HTMLElement>("#tour-freeplay");
  const free = tour?.state.freePlay === true;
  const requestedPanel = tour?.step.panel;
  const panelsVisible = free || requestedPanel !== undefined || story !== undefined || note !== undefined;
  const surfaces = tour?.state.everything || free ? complete : tour?.step.surfaces ?? complete;
  const stopMotion = useCallback(() => { controls?.cancel(); setManual(true); interact(); }, [controls]);
  const pickStory = useCallback((id: string | undefined, picked?: string) => {
    interact(); setStory(id); setCapability(picked); setNote(undefined); core.pin(undefined);
  }, [core]);
  const pickCapability = useCallback((id: string) => { interact(); setCapability(id); }, []);
  const closeStory = useCallback(() => { setStory(undefined); setCapability(undefined); }, []);
  const pickNote = useCallback((id: string) => { interact(); setNote(id); setStory(undefined); core.pin(id); }, [core]);
  const closeNote = useCallback(() => { setNote(undefined); core.pin(undefined); }, [core]);
  const onHighlight = useCallback((stories: readonly string[] | undefined, session?: string) => setHighlight({ stories, session }), []);
  const onControls = useCallback((next: GlobeControls | undefined) => setControls(next), []);
  useEffect(() => {
    const hear = (event: Event) => setTour((event as CustomEvent<Tour>).detail);
    window.addEventListener("storytree-tour", hear);
    window.dispatchEvent(new Event("storytree-tour-request"));
    return () => window.removeEventListener("storytree-tour", hear);
  }, []);
  useEffect(() => {
    const step = tour?.step.id;
    if (!step) return;
    if (!tour.state.freePlay && step === "sessions-recording") replay();
    else if (tour.state.freePlay || previousStep.current === "sessions-recording" || previousGeneration.current !== tour.state.generation) finishRecording();
    previousStep.current = step;
    previousGeneration.current = tour.state.generation;
  }, [tour?.state.index, tour?.state.generation, tour?.state.freePlay, replay, finishRecording]);
  useEffect(() => {
    let clock = performance.now();
    let index = recording.progress().index;
    setProgress(recording.progress());
    if (tour?.state.paused || tour?.state.why || tour?.state.everything || index === recording.progress().total) return;
    let frame: number;
    const tick = (now: number) => {
      const delta = Math.min(now - clock, 1000);
      clock = now;
      const next = recording.advance(delta, { paused: document.hidden, speed: tour?.state.speed ?? 1 });
      if (next.index !== index) { index = next.index; setProgress(next); }
      if (index < next.total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [recording, tour?.state.paused, tour?.state.why, tour?.state.everything, tour?.state.speed]);
  useEffect(() => {
    if (!controls) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(ready));
    return () => cancelAnimationFrame(frame);
  }, [controls, ready]);
  useEffect(() => {
    if (panelHost) panelHost.hidden = !panelsVisible;
  }, [panelHost, panelsVisible]);
  useEffect(() => {
    if (!tour) return;
    setManual(false);
    setUserStop(undefined);
    setMode(tour.step.panel === "knowledge" && !tour.state.everything && !tour.state.freePlay ? "library" : "forest");
    if (!tour.state.freePlay) { setStory(undefined); setCapability(undefined); setNote(undefined); core.pin(undefined); }
    if (!tour.state.freePlay && tour.step.panel === "stories") {
      const target = tour.step.target;
      const owning = target?.kind === "story" ? target.story : target?.kind === "capability"
        ? snapshot.tree.stories.find(owner => owner.capabilities.some(item => item.id === target.capability))?.id : undefined;
      setStory(owning ?? snapshot.tree.stories[0]?.id);
      setCapability(target?.kind === "capability" ? target.capability : undefined);
    }
  }, [tour?.state.index, tour?.state.generation, tour?.state.freePlay, tour?.state.everything]);
  useEffect(() => {
    if (!tour || !controls) return;
    controls.cancel();
    if (tour.state.freePlay || manual || tour.state.paused || tour.state.why || tour.state.everything) return;
    // Every active transition retakes the target, including resuming an interrupted stop.
    if (tour.step.target) controls.stop({ target: tour.step.target, framing: tour.step.framing ?? 1.4, duration: reduced() ? 0 : 700 });
    if (tour.state.index !== 0 || reduced()) return;
    let island = 0;
    const turn = () => {
      const place = snapshot.places[island++ % snapshot.places.length];
      if (place) controls.stop({ target: { kind: "story", story: place.id }, framing: 1.4, duration: 20_000 });
    };
    turn();
    const timer = setInterval(turn, 20_000);
    return () => { clearInterval(timer); controls.cancel(); };
  }, [controls, tour?.state.index, tour?.state.generation, tour?.state.paused, tour?.state.why, tour?.state.everything, tour?.state.freePlay, manual]);
  // A user's turn starts after pausing has cancelled the tour's previous camera movement.
  useEffect(() => { if (userStop) controls?.stop(userStop); }, [controls, userStop]);
  const inspectStory = (id: string) => {
    stopMotion(); pickStory(id);
    setUserStop({ target: { kind: "story", story: id }, framing: 1.1, duration: reduced() ? 0 : 700 });
  };
  const turn = (by: number) => {
    const index = Math.max(0, snapshot.places.findIndex(place => place.id === story));
    const next = snapshot.places[(index + by + snapshot.places.length) % snapshot.places.length];
    if (next) inspectStory(next.id);
  };
  const shownNotes = notes.filter(item => String(item.fields.title ?? "").toLowerCase().includes(query.toLowerCase()));
  return <>
    {webgl && <GlobeBoundary failed={failed}>
      <div className="forest-drawing" role="group" aria-label="Storytree’s saved project globe" onPointerDown={stopMotion} onWheel={stopMotion}>
        <PlanetView core={core} scene={snapshot.scene} places={places} wisps={wisps} selected={story}
          highlighted={highlight.stories} highlightedSession={highlight.session} onPick={pickStory} onNote={pickNote}
          onWispHover={() => {}} onControls={onControls} surfaces={surfaces} framing={free || tour?.state.everything ? 1.4 : tour?.step.framing ?? 1.4} mode={mode} />
      </div>
      <div className="forest-controls" aria-label="Explore the saved globe">
        <button type="button" onClick={() => turn(-1)} aria-label="Turn map left">←</button>
        <button type="button" onClick={() => { stopMotion(); setMode("forest"); setUserStop({ target: { kind: "story", story: snapshot.places[0]!.id }, framing: 1.4, duration: reduced() ? 0 : 700 }); }}>Reset view</button>
        <button type="button" onClick={() => turn(1)} aria-label="Turn map right">→</button>
        <button type="button" aria-pressed={mode === "library"} onClick={() => { stopMotion(); setMode(before => before === "forest" ? "library" : "forest"); }}>Look inside</button>
      </div>
    </GlobeBoundary>}
    {panelHost && createPortal(<>
      <p className="tour-recorded-label">Saved 2 October 2026 · recorded activity 00:00–04:15 UTC · read only</p>
      <div className="tour-record-browser" hidden={!free && requestedPanel !== "stories" && !story}>
        <label htmlFor="tour-story-choice">Explore a story</label>
        <select id="tour-story-choice" value={story ?? ""} onChange={event => inspectStory(event.target.value)}>
          <option value="" disabled>Choose an island…</option>
          {snapshot.tree.stories.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        {story && <StoryDetails story={story} capability={capability} choose={pickCapability} close={closeStory} />}
      </div>
      <div hidden={!free && requestedPanel !== "sessions"}>
        <div className="tour-recording-controls">
          <p id="recording-progress" data-recording-index={progress.index} data-recording-total={progress.total}>
            {progress.index === progress.total ? "All recorded activity" : tour?.state.paused || tour?.state.why || tour?.state.everything ? "Activity replay paused" : "Activity replay"}
            {` · ${progress.index} / ${progress.total} events · `}<time dateTime={progress.at}>{progress.at.slice(11, 19)} UTC</time>
          </p>
          <button id="recording-replay" type="button" onClick={replay}>Replay recording</button>
          <button id="recording-end" type="button" onClick={finishRecording}>End of recording</button>
          <p>Compressed playback: one saved event per second at 1×. Use the tour’s Pause and Speed controls. Plan and code stay at the saved capture.</p>
        </div>
        <Sessions recording={recording} core={core} onWisps={setWisps} onHighlight={onHighlight} />
        <p className="tour-recording-note">Context totals and transcript windows were not captured. An empty bar means unavailable.</p>
      </div>
      <div hidden={!free && requestedPanel !== "arcs"}>
        <Arcs recording={recording} open={requestedPanel === "arcs" || free} />
      </div>
      <div className="tour-knowledge" hidden={!free && requestedPanel !== "knowledge" && !note}>
        <label htmlFor="tour-note-search">Find a recorded library note</label>
        <input id="tour-note-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search decisions and guidance" />
        <label htmlFor="tour-note-choice">Library note</label>
        <select id="tour-note-choice" value={note ?? ""} onChange={event => pickNote(event.target.value)}>
          <option value="" disabled>Choose a note…</option>
          {shownNotes.map(item => <option key={item.id} value={item.id}>{String(item.fields.title ?? item.id)}</option>)}
        </select>
        {shownNotes.length === 0 && <p>No saved notes match that search.</p>}
        <KnowledgeNoteCard core={core} onClose={closeNote} />
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

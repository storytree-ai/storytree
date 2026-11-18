// Capability 5 · Recorder
import { CATALOGUE, sheetDrag, type PageState } from "@storytree/forest/actions";
import type { LagBridge } from "./bridge.js";
import { createRecorder, type Entry } from "./recorder.js";

const FLUSH_EVERY_MS = 30_000;

export type RecorderWindow = Pick<Window, "addEventListener" | "removeEventListener" | "requestAnimationFrame" | "setTimeout" | "setInterval" | "clearInterval" | "location" | "document" | "performance">
  & { PerformanceObserver?: typeof PerformanceObserver; storytreeGlobe?: GlobeSeam };

type GlobeSeam = { islands(): { story: string; capabilities: number }[]; still(): boolean };

function readPage(win: RecorderWindow, withProgress: boolean): PageState {
  const document = win.document;
  const panel = document.querySelector<HTMLElement>(".story-panel");
  const shown = (element: Element) => !(element as HTMLElement).hidden && element.getClientRects().length > 0;
  return {
    selected: document.body.dataset.selected, note: document.body.dataset.note, panelOpen: panel !== null && !panel.hidden,
    mode: document.querySelector<HTMLElement>("[data-forest-mode]")?.dataset.forestMode,
    sessionSelected: document.querySelector(".session-row[data-selected]") !== null, still: win.storytreeGlobe?.still() ?? true,
    progress: withProgress && [...document.querySelectorAll("[role=progressbar], [aria-busy=true]")].some(shown),
    startSettled: document.body.dataset.start === "settled",
  };
}

export function mountLagRecorder(bridge: LagBridge, win: RecorderWindow = window): { stop(): void } | undefined {
  if (new URLSearchParams(win.location.search).get("lag-recorder") === "off") return undefined;
  const recorder = createRecorder({
    catalogue: CATALOGUE,
    send: (readings) => bridge.recordLag(readings),
    size: (story) => win.storytreeGlobe?.islands().find((island) => island.story === story)?.capabilities,
  });
  let watching = false;
  const watch = () => {
    watching = true;
    win.requestAnimationFrame((time) => {
      recorder.turnFrame(time);
      if (recorder.pending) watch();
      else watching = false;
      win.setTimeout(() => recorder.frame(win.performance.now(), readPage(win, true)), 0);
    });
  };
  const onInput = (event: Event) => {
    if (!event.isTrusted) return recorder.scripted();
    const mode = event.type === "pointerdown" && (event.target as Element | null)?.tagName === "CANVAS" && sheetDrag(event as PointerEvent) === "spin"
      ? readPage(win, false).mode : undefined;
    if (mode === "forest" || mode === "library") recorder.turnStart(event.timeStamp, mode);
    else recorder.input(event.timeStamp, readPage(win, false));
    if (!watching) watch();
  };
  const onClick = (event: Event) => { if (!event.isTrusted) recorder.scripted(); };
  const onMove = (event: Event) => { if (event.isTrusted) recorder.turnMove(); };
  const onLetGo = (event: Event) => { if (event.isTrusted) recorder.turnEnd(event.timeStamp); };
  const turnListeners: [string, (event: Event) => void][] = [["click", onClick], ["pointermove", onMove], ["pointerup", onLetGo], ["pointercancel", onLetGo]];
  const observers: PerformanceObserver[] = [];
  const observe = (type: string, deliver: (entries: Entry[]) => void, options: PerformanceObserverInit) => {
    if (win.PerformanceObserver?.supportedEntryTypes?.includes(type) !== true) return;
    const observer = new win.PerformanceObserver((list) => deliver(list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration }))));
    observer.observe({ type, buffered: false, ...options });
    observers.push(observer);
  };
  observe("event", (events) => recorder.observe({ events }), { durationThreshold: 16 } as PerformanceObserverInit);
  observe("long-animation-frame", (frames) => recorder.observe({ frames }), {});
  const flush = () => recorder.flush();
  const onHide = () => { if (win.document.visibilityState === "hidden") flush(); };
  for (const type of ["pointerdown", "keydown"]) win.addEventListener(type, onInput, { capture: true, passive: true });
  for (const [type, listener] of turnListeners) win.addEventListener(type, listener, { capture: true, passive: true });
  win.addEventListener("pagehide", flush);
  win.document.addEventListener("visibilitychange", onHide);
  const timer = win.setInterval(flush, FLUSH_EVERY_MS);
  return {
    stop() {
      for (const type of ["pointerdown", "keydown"]) win.removeEventListener(type, onInput, { capture: true });
      for (const [type, listener] of turnListeners) win.removeEventListener(type, listener, { capture: true });
      win.removeEventListener("pagehide", flush);
      win.document.removeEventListener("visibilitychange", onHide);
      win.clearInterval(timer);
      for (const observer of observers) observer.disconnect();
      flush();
    },
  };
}

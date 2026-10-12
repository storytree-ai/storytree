/**
 * Capability 1 · Recorder. The recorder mounted on the page: it hears trusted inputs, reads what the page shows each frame while an
 * action is under way (the same reading the lab instrument takes, packages/dev-loop/src/desktop-lag.mjs), and hands the browser's
 * Event Timing and Long Animation Frame entries to the core. Nothing runs on the input path but one read of the page; readings
 * reach the app every half minute, or as the page hides, and only when no action is under way (ADR-0836 D1). The lab switches it
 * off with `?lag-recorder=off`, so the catalogue can be measured with it and without.
 */
import { CATALOGUE, type PageState } from "@storytree/forest/actions";
import type { LagBridge } from "./bridge.js";
import { createRecorder, type Entry } from "./recorder.js";

const FLUSH_EVERY_MS = 30_000;

/** The parts of the page's window the recorder uses. */
export type RecorderWindow = Pick<Window, "addEventListener" | "removeEventListener" | "requestAnimationFrame" | "setTimeout" | "setInterval" | "clearInterval" | "location" | "document" | "performance">
  & { PerformanceObserver?: typeof PerformanceObserver; storytreeGlobe?: GlobeSeam };

/** What the recorder reads of the forest's globe locator (`window.storytreeGlobe`, forest 3.41): the islands' sizes and stillness. */
type GlobeSeam = { islands(): { story: string; capabilities: number }[]; still(): boolean };

/** What the page shows, as the catalogue's settled reads it; whether progress is on show only when asked, since it measures layout. */
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

/** Start recording on `win`, handing readings to `bridge`; undefined when the page was opened with the recorder off. */
export function mountLagRecorder(bridge: LagBridge, win: RecorderWindow = window): { stop(): void } | undefined {
  if (new URLSearchParams(win.location.search).get("lag-recorder") === "off") return undefined;
  const recorder = createRecorder({
    catalogue: CATALOGUE,
    send: (readings) => bridge.recordLag(readings),
    size: (story) => win.storytreeGlobe?.islands().find((island) => island.story === story)?.capabilities,
  });
  // Every frame is watched while an action is under way, and each frame's page is read once the frame's own callbacks have run
  // (the globe's glide among them), not before them: read first, a frame's stillness would be seen one frame late.
  let watching = false;
  const watch = () => {
    watching = true;
    win.requestAnimationFrame(() => {
      if (recorder.pending) watch();
      else watching = false;
      win.setTimeout(() => recorder.frame(win.performance.now(), readPage(win, true)), 0);
    });
  };
  const onInput = (event: Event) => {
    if (!event.isTrusted) return;
    recorder.input(event.timeStamp, readPage(win, false));
    if (!watching) watch();
  };
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
  win.addEventListener("pagehide", flush);
  win.document.addEventListener("visibilitychange", onHide);
  const timer = win.setInterval(flush, FLUSH_EVERY_MS);
  return {
    stop() {
      for (const type of ["pointerdown", "keydown"]) win.removeEventListener(type, onInput, { capture: true });
      win.removeEventListener("pagehide", flush);
      win.document.removeEventListener("visibilitychange", onHide);
      win.clearInterval(timer);
      for (const observer of observers) observer.disconnect();
      flush();
    },
  };
}

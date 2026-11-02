// The page's stand-in for the desktop app's main process, run before the real renderer: the capture kit's own fake
// bridge (apps/desktop/src/capture/fake-bridge.ts), answered from data.json's snapshot of the real library, so the
// built page opens from disk with no app, no library and no network.
import { fakeBridge } from "../../../../../apps/desktop/src/capture/fake-bridge.ts";
import data from "../data.json";

const copy = <T>(value: T): T => structuredClone(value);
const bridge = fakeBridge({
  projectSelection: async () => copy({ projects: ["storytree"], current: "storytree" }),
  chooseProject: async () => copy({ projects: ["storytree"], current: "storytree" }),
  listProjects: async () => ["storytree"],
  projectTree: async () => copy(data.seed.tree),
  changesSince: async () => ({ changes: [], cursor: 0 }),
  linesSince: async () => ({ lines: [], cursor: 0 }),
  frontCovers: async () => [], relatedNotes: async () => [], readSurfaces: async () => undefined,
  codeSurvey: async () => copy(data.seed.survey),
} as never);
const page = window as unknown as Record<string, unknown>;
page.storytreeFakeBridge = (method: string, args: unknown[]) => bridge.call(method, args);
page.storytree = new Proxy({}, { get: (_, method) => method === "then" ? undefined : method === "pluginViews" ? [] : (...args: unknown[]) => bridge.call(String(method), args) });
try { localStorage.setItem("storytree:setup:guide-seen:v1", "yes"); } catch { /* storage refused: the guide shows */ }
new MutationObserver(() => { for (const card of document.querySelectorAll<HTMLElement>(".teaching-card")) card.style.display = "none"; }).observe(document, { childList: true, subtree: true });
// The capture seams the real page reports into (planet-view.tsx), so the timber layer can reach the scene.
page.__storytreeCaptureGlobe = (get: () => unknown) => Object.defineProperty(globalThis, "__globe", { get, configurable: true });
page.__storytreeCaptureNavigation = (nav: unknown) => { page.__nav = nav; };

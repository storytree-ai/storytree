// Capability 2 · Storytree projects
import type { Page } from "playwright-core";

import type { StorytreeBridge } from "../bridge.js";
import { loadedSeedLayouts } from "./seeds.js";

export interface FakeBridge {
  call(method: string, args: readonly unknown[]): Promise<unknown>;
  readonly defaulted: readonly string[];
  readonly unanswered: Promise<never>;
  install(page: Page): Promise<void>;
  ready(page: Page, timeoutMs?: number): Promise<void>;
}

const PAGE_BRIDGE = `window.storytree = new Proxy({}, { get: (_, method) => method === "then" ? undefined : method === "pluginViews" ? [] : (...args) => typeof window.storytreeAnswers?.[method] === "function" ? window.storytreeAnswers[method](...args) : window.storytreeFakeBridge(String(method), args) });`;

const GUIDE_SEEN = `try { localStorage.setItem("storytree:setup:guide-seen:v1", "yes"); } catch { /* about:blank has no storage */ }`;

const TEACHING_HIDDEN = `new MutationObserver(() => { for (const card of document.querySelectorAll(".teaching-card")) card.style.display = "none"; }).observe(document, { childList: true, subtree: true });`;

const keptLayouts = (layouts: Readonly<Record<string, string>>): string =>
  `try { for (const [key, value] of Object.entries(${JSON.stringify(layouts)})) if (localStorage.getItem(key) === null) localStorage.setItem(key, value); } catch { /* about:blank has no storage */ }`;

export interface FakeBridgeOptions {
  layouts?: Readonly<Record<string, string>> | undefined;
  guide?: "seen" | "unseen" | undefined;
  teaching?: "hidden" | "shown" | undefined;
}

const PROJECT = "storytree";
const unread = (session: string) => ({ session, absent: "a capture's stand-in bridge reads no transcript", at: new Date().toISOString() });
const idle = { phase: "unavailable", runningBuild: "capture", reason: "a capture's stand-in bridge" } as const;

const QUIET: StorytreeBridge = {
  readJourney: async () => ({ consent: "off", available: false, installId: "00000000-0000-4000-8000-000000000000", queued: 0 }),
  chooseJourney: async () => { throw new Error("a capture’s stand-in bridge changes no sharing consent"); },
  prepareJourneyDeletion: async () => { throw new Error("a capture’s stand-in bridge prepares no deletion request"); },
  checkForUpdates: async () => idle,
  readSignIn: async () => ({ available: false, on: false }),
  setSignIn: async () => ({ available: false, on: false }),
  readInstallChoice: async () => ({ available: false, choice: { mode: "quiet" } }),
  setInstallChoice: async () => { throw new Error("a capture's stand-in bridge keeps no install choice"); },
  readReleaseChannel: async () => ({ available: false, channel: "stable" }),
  setReleaseChannel: async () => { throw new Error("a capture's stand-in bridge keeps no release channel"); },
  readSetupLicense: async () => "",
  agentConnections: async () => [],
  agentsToConnect: async () => [],
  connectAgent: async () => ({ agent: "", connected: false, next: "" }),
  checkSetupFolder: async () => null,
  factoryFolder: async () => ({ folder: "/home/you/.storytree/your-factory", chosen: false }),
  chooseFactory: async () => null,
  addProject: async () => null,
  removeProject: async () => { throw new Error("a capture's stand-in bridge removes no project"); },
  projectSentence: async () => ({}),
  setProjectSentence: async () => { throw new Error("a capture's stand-in bridge saves no sentence"); },
  deletableProjects: async () => [],
  deleteProject: async () => { throw new Error("a capture's stand-in bridge deletes no project"); },
  openFeedbackDraft: async () => ({ status: "failed", error: "a capture's stand-in bridge opens no draft" }),
  copyHelpText: async () => {},
  readSurfaces: async () => ({ ok: true, value: [] }),
  saveSurface: async () => ({ ok: false, error: "a capture's stand-in bridge saves no surface" }),
  listProjects: async () => [PROJECT],
  projectSelection: async () => ({ projects: [PROJECT], current: PROJECT }),
  chooseProject: async () => ({ projects: [PROJECT], current: PROJECT }),
  arcViews: async () => [],
  boardArcs: async () => [],
  closedArcs: async () => [],
  holds: async () => ({ waits: {}, heldOn: {} }),
  prCutover: async () => undefined,
  contextReadings: async (_, sessions) => sessions.map(unread),
  idleAfterMs: async () => 30 * 60_000,
  leaveAfterMs: async () => 60 * 60_000,
  windowReading: async (_, session) => unread(session),
  projectTree: async () => ({ stories: [], arcs: [] }),
  changesSince: async (_, cursor) => ({ changes: [], cursor }),
  linesSince: async (_, cursor) => ({ lines: [], cursor }),
  inherited: async () => [],
  frontCovers: async () => [],
  relatedNotes: async () => [],
  standingDelegations: async () => undefined,
  codeSurvey: async () => ({}),
  pins: async () => [],
  recordLag: async () => {},
  feedbackSetup: async () => ({ offered: false, surfaces: [] }),
  ciTimes: async () => undefined,
  captureForFeedback: async () => undefined,
  sendFeedback: async () => { throw new Error("a capture's stand-in bridge writes no feedback"); },
  pluginViews: [],
  startMark: async () => {},
};

export function installedUpdates(state: "idle" | "waiting"): Pick<StorytreeBridge, "checkForUpdates" | "readInstallChoice" | "readReleaseChannel" | "readSignIn"> {
  const runningBuild = "0.3.2700";
  const nextBuild = "0.3.2741";
  return {
    checkForUpdates: async () => state === "idle" ? { phase: "idle", runningBuild } : { phase: "pending", runningBuild, nextBuild },
    readInstallChoice: async () => ({ available: true, choice: { mode: "quiet" } }),
    readReleaseChannel: async () => ({ available: true, channel: "stable", stable: { version: state === "idle" ? runningBuild : nextBuild, published: "2026-11-05" } }),
    readSignIn: async () => ({ available: true, on: true }),
  };
}

type Lines = Awaited<ReturnType<StorytreeBridge["linesSince"]>>;

function startFromLines({ lines, cursor }: Lines, kinds: readonly string[]) {
  return { lines: lines.filter(line => kinds.includes(line.kind)), sessions: lines, claims: lines, cursor };
}

export function fakeBridge(answers: Partial<StorytreeBridge>, { guide = "seen", teaching = "hidden", layouts = loadedSeedLayouts() }: FakeBridgeOptions = {}): FakeBridge {
  let refuse!: (error: Error) => void;
  const unanswered = new Promise<never>((_, reject) => (refuse = reject));
  unanswered.catch(() => {});
  const methods = answers as Record<string, ((...args: unknown[]) => unknown) | undefined>;
  const quiet = QUIET as unknown as Record<string, (...args: unknown[]) => unknown>;
  const defaulted: string[] = [];

  const call = async (method: string, args: readonly unknown[]): Promise<unknown> => {
    if (method === "linesStart" && !Object.hasOwn(methods, method)) {
      if (!defaulted.includes(method)) defaulted.push(method);
      return startFromLines(await call("linesSince", [args[0], 0]) as Lines, args[1] as readonly string[]);
    }
    if (method === "sessionLines" && !Object.hasOwn(methods, method)) {
      if (!defaulted.includes(method)) defaulted.push(method);
      const sessions = args[1] as readonly string[];
      return (await call("linesSince", [args[0], 0]) as Lines).lines.filter(({ session }) => sessions.includes(session));
    }
    if (!Object.hasOwn(methods, method) && Object.hasOwn(quiet, method)) {
      if (!defaulted.includes(method)) defaulted.push(method);
      return quiet[method]!(...args);
    }
    const answer = Object.hasOwn(methods, method) ? methods[method] : undefined;
    if (answer === undefined) {
      const error = new Error(`the fake bridge does not answer ${method}: hand the capture's fakeBridge an answer for it`);
      refuse(error);
      throw error;
    }
    return answer(...args);
  };
  return {
    call,
    defaulted,
    unanswered,
    async install(page) {
      await page.exposeFunction("storytreeFakeBridge", call);
      await page.addInitScript(PAGE_BRIDGE);
      if (guide === "seen") await page.addInitScript(GUIDE_SEEN);
      if (teaching === "hidden") await page.addInitScript(TEACHING_HIDDEN);
      await page.addInitScript(keptLayouts(layouts));
    },
    async ready(page, timeoutMs = 60_000) {
      await Promise.race([page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: timeoutMs }), unanswered]);
    },
  };
}

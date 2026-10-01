/**
 * A fake `window.storytree` for a capture: it answers what the capture hands it, and every other
 * bridge method with a quiet answer of the right shape, so a capture written before the bridge grew
 * still reaches ready. It records which methods the page asked that the capture left to those
 * answers. A call that is no bridge method at all fails the capture at once, naming the method,
 * instead of the renderer landing on its error page while the capture waits out a timeout.
 */
import type { Page } from "playwright-core";

import type { StorytreeBridge } from "../bridge.js";

export interface FakeBridge {
  /** The page's call of `method`: its answer, or a refusal naming the method when there is none. */
  call(method: string, args: readonly unknown[]): Promise<unknown>;
  /** The bridge methods the page asked that the capture left to the quiet answers, in the order first asked. */
  readonly defaulted: readonly string[];
  /** Rejects, naming the method, at the first call the fake cannot answer; never resolves. */
  readonly unanswered: Promise<never>;
  /** Put the fake on `page` as window.storytree, before the page's own scripts run. */
  install(page: Page): Promise<void>;
  /** Wait until `page`'s body reads data-state=ready, failing at once on an unanswered call. */
  ready(page: Page, timeoutMs?: number): Promise<void>;
}

/**
 * window.storytree in the page: a method the page's own `window.storytreeAnswers` holds is answered
 * there (a capture that keeps its seeded state in the page sets it in an init script); every other
 * is carried to the fake. Text, not a function, since a capture run through tsx would hand the page
 * esbuild's __name helper, which the page lacks. `then` stays unanswered so that awaiting the bridge
 * itself is not mistaken for a call.
 */
const PAGE_BRIDGE = `window.storytree = new Proxy({}, { get: (_, method) => method === "then" ? undefined : (...args) => typeof window.storytreeAnswers?.[method] === "function" ? window.storytreeAnswers[method](...args) : window.storytreeFakeBridge(String(method), args) });`;

const PROJECT = "storytree";
/** A session's reading, context or window, that the stand-in cannot make: no transcript is read. */
const unread = (session: string) => ({ session, absent: "a capture's stand-in bridge reads no transcript", at: new Date().toISOString() });
const idle = { phase: "unavailable", runningBuild: "capture", reason: "a capture's stand-in bridge" } as const;

/**
 * A quiet answer for every bridge method: one project with nothing in it, nothing running, nothing
 * set up, every change refused. Typed as the whole bridge, so a method the bridge gains needs one here.
 */
const QUIET: StorytreeBridge = {
  checkForUpdates: async () => idle,
  readSignIn: async () => ({ available: false, on: false }),
  setSignIn: async () => ({ available: false, on: false }),
  readSetupLicense: async () => "",
  agentConnections: async () => [],
  checkSetupFolder: async () => null,
  addProject: async () => null,
  removeProject: async () => { throw new Error("a capture's stand-in bridge removes no project"); },
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
  holds: async () => ({ waits: {}, heldOn: {} }),
  contextReadings: async (_, sessions) => sessions.map(unread),
  idleAfterMs: async () => 30 * 60_000,
  leaveAfterMs: async () => 60 * 60_000,
  windowReading: async (_, session) => unread(session),
  windowReadings: async (_, sessions) => sessions.map(unread),
  projectTree: async () => ({ stories: [], arcs: [] }),
  changesSince: async (_, cursor) => ({ changes: [], cursor }),
  linesSince: async (_, cursor) => ({ lines: [], cursor }),
  frontCovers: async () => [],
  relatedNotes: async () => [],
  standingDelegations: async () => undefined,
  codeSurvey: async () => ({}),
};

/** A fake bridge answering with `answers`, and with the quiet answers for the rest, typed against the desktop app's own bridge. */
export function fakeBridge(answers: Partial<StorytreeBridge>): FakeBridge {
  let refuse!: (error: Error) => void;
  const unanswered = new Promise<never>((_, reject) => (refuse = reject));
  unanswered.catch(() => {});
  const methods = answers as Record<string, ((...args: unknown[]) => unknown) | undefined>;
  const quiet = QUIET as unknown as Record<string, (...args: unknown[]) => unknown>;
  const defaulted: string[] = [];

  const call = async (method: string, args: readonly unknown[]) => {
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
    },
    async ready(page, timeoutMs = 60_000) {
      await Promise.race([page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: timeoutMs }), unanswered]);
    },
  };
}

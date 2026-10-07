/** Capability 2 · PostHog delivery. */
import { homedir } from "node:os";
import path from "node:path";
import { openJourney, type JourneyConfiguration, type JourneyTransport } from "./index.js";
import type { DeletionRequest, JourneyBridge, JourneyState } from "./bridge.js";

/** PostHog's public project token, stamped into shipped builds only (release.ts); absent in development copies. */
declare const STORYTREE_JOURNEY_KEY: string | undefined;
const RELEASE_CONFIGURATION = releaseConfiguration(typeof STORYTREE_JOURNEY_KEY === "string" ? STORYTREE_JOURNEY_KEY : undefined);

/** US project 645059 on PostHog's free plan (one year of events); the owner is the deletion contact. */
export function releaseConfiguration(projectKey: string | undefined): JourneyConfiguration | undefined {
  return projectKey === undefined ? undefined
    : { projectKey, retention: "1 year (PostHog's free plan)", deletionContact: "hua.mick@gmail.com" };
}

export type JourneyRuntime = ReturnType<typeof createJourneyRuntime>;

/** The tool binary's public release stamp; development copies carry no release stamp. */
export function journeyVersion(release: unknown): string {
  try {
    const version: unknown = typeof release === "string" ? JSON.parse(release).version : undefined;
    if (typeof version === "string" && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(version)) return version;
  } catch { /* An unstamped development copy. */ }
  return "0.3.0";
}

export function createJourneyRuntime(options: {
  home?: string;
  appVersion: string;
  configuration?: JourneyConfiguration;
  transport?: JourneyTransport;
}) {
  let journey: ReturnType<typeof openJourney> | undefined;
  let desktop: { installed: boolean } | undefined;
  let finishing: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const configuration = options.configuration ?? RELEASE_CONFIGURATION;
  const open = () => journey ??= openJourney({
    home: options.home ?? (process.env.STORYTREE_HOME || path.join(homedir(), ".storytree", "0.3")),
    appVersion: options.appVersion,
    ...(configuration ? { configuration } : {}),
  });
  function record(event: unknown): void {
    if (finishing || configuration === undefined) return;
    // Observation must never break the journey it observes, or send error content about itself.
    try { open().record(event); } catch { /* Optional observation stays quiet on local failure. */ }
  }
  function launch(): void {
    if (desktop === undefined) return;
    if (desktop.installed) record("installed");
    record("first_launch");
    record("app_version");
  }
  async function flush(): Promise<void> {
    try { if (!finishing) await journey?.flush(options.transport); } catch { /* Observation cannot stop the app. */ }
  }
  function start(): void { timer ??= setInterval(() => { void flush(); }, 30_000).unref(); }
  const bridge: JourneyBridge = {
    async readJourney() { return open().state(); },
    async chooseJourney(on) { const after = open().choose(on); if (on) { launch(); if (desktop) void flush(); } return { ...after, queued: open().state().queued }; },
    async prepareJourneyDeletion() { return open().prepareDeletion(); },
  };
  return { ...bridge, record,
    start,
    projectCreated() { record("first_project"); },
    afterProjectAdded<T extends { status: string } | null>(result: T): T {
      if (result?.status === "set up") record("first_project");
      return result;
    },
    incrementClosed(outcome: unknown) { if (outcome === "landed") record("first_landed_increment"); },
    hooksVerified() { record("hooks_verified"); },
    agentConnected() { record("agent_connected"); },
    desktopStarted(installed: boolean) {
      desktop = { installed }; launch(); void flush();
      start();
    },
    flush,
    finish(): Promise<void> {
      return finishing ??= (async () => {
        clearInterval(timer);
        try { await journey?.flush(options.transport); } catch { /* Best effort, never block shutdown. */ }
        finally { try { journey?.close(); } catch { /* Normal application cleanup must still run. */ } }
      })();
    },
  };
}

export function formatJourneyState(state: JourneyState): string {
  const choice = state.consent === "on" ? "on" : state.consent === "off" ? "off" : "not chosen (off)";
  return `Journey sharing: ${choice}. ${state.available ? `PostHog US; retention: ${state.retention}. ${state.queued} queued events.` : "Sharing is not available in this build; nothing is sent."}`;
}
export function formatDeletionRequest(request: DeletionRequest): string {
  return `Sharing is off and this computer's queued events are cleared.\nInstallation ID: ${request.installId}\n${request.contact ? `Ask ${request.contact} to delete events for this ID.` : "No deletion contact is configured in this build."} Remote deletion has not been requested or confirmed.`;
}

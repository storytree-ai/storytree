import { PostHog } from "posthog-node";

export interface DeliveryEvent {
  uuid: string;
  event: string;
  distinctId: string;
  timestamp: string;
  properties: { app_version: string };
}

export const JOURNEY_EVENTS = new Set(["installed", "first_launch", "agent_connected", "hooks_verified", "first_project", "first_landed_increment", "error", "app_version"]);
export const JOURNEY_VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = () => new Error("Journey event delivery unavailable");

/** Storytree owns persistence and retries. Each immediate SDK send has no background queue. */
export function createPostHogTransport(options: {
  projectKey: string;
  permitted: () => boolean;
  fetch?: typeof globalThis.fetch;
}): { send(event: DeliveryEvent): Promise<void>; close(): Promise<void> } {
  const fetch = options.fetch ?? globalThis.fetch;
  let closed = false;
  const pending = new Set<Promise<void>>();
  const permitted = () => !closed && /^phc_[A-Za-z0-9_]+$/.test(options.projectKey) && options.permitted();

  async function deliver(event: DeliveryEvent): Promise<void> {
    let accepted = false;
    let client: PostHog | undefined;
    try {
      if (!permitted() || !UUID.test(event.uuid) || !UUID.test(event.distinctId)
        || !JOURNEY_EVENTS.has(event.event) || !JOURNEY_VERSION.test(event.properties.app_version)
        || Object.keys(event.properties).length !== 1 || new Date(event.timestamp).toISOString() !== event.timestamp) throw unavailable();
      client = new PostHog(options.projectKey, {
        host: "https://us.i.posthog.com",
        flushAt: 1,
        flushInterval: 0,
        fetchRetryCount: 0,
        requestTimeout: 1_000,
        disableCompression: true,
        disableGeoip: true,
        enableLocalEvaluation: false,
        preloadFeatureFlags: false,
        disableSurveys: true,
        enableExceptionAutocapture: false,
        fetch: async (url, init) => {
          // captureImmediate in this pinned SDK catches its own failures. Record the actual
          // HTTP acknowledgement here; keep vendor error bodies and request keys out of SDK logs.
          let timer: ReturnType<typeof setTimeout> | undefined;
          const controller = new AbortController();
          try {
            if (url !== "https://us.i.posthog.com/batch/"|| typeof init.body !== "string" || !permitted()) throw unavailable();
            const deadline = new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, 900);
            });
            const response = await Promise.race([
              fetch(url, {
                method: "POST", headers: init.headers, body: init.body, redirect: "error",
                signal: init.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal,
              }),
              deadline,
            ]);
            accepted = response.ok;
            void response.body?.cancel().catch(() => {});
          } catch { accepted = false; }
          finally { clearTimeout(timer); }
          // A neutral SDK response prevents internal retries/logging. Only `accepted` below
          // is returned to Storytree as success; failed or blocked events remain on disk.
          return Response.json({ status: 1 });
        },
      });
      await client.captureImmediate({
        uuid: event.uuid, event: event.event, distinctId: event.distinctId,
        timestamp: new Date(event.timestamp), properties: { app_version: event.properties.app_version },
        sendFeatureFlags: false, disableGeoip: true,
      });
      if (!accepted) throw unavailable();
    } catch { throw unavailable(); }
    finally { await client?.shutdown(1_000); }
  }

  return {
    send(event) {
      const operation = deliver(event);
      pending.add(operation);
      void operation.then(() => pending.delete(operation), () => pending.delete(operation));
      return operation;
    },
    async close() {
      closed = true;
      await Promise.allSettled([...pending]);
    },
  };
}

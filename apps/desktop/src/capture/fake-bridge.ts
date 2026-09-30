/**
 * A fake `window.storytree` for a capture: it answers what the capture hands it and nothing else.
 * The first call it cannot answer fails the capture at once, naming the method, instead of the
 * renderer landing on its error page while the capture waits out a timeout for data-state=ready.
 */
import type { Page } from "playwright-core";

import type { StorytreeBridge } from "../bridge.js";

export interface FakeBridge {
  /** The page's call of `method`: its answer, or a refusal naming the method when there is none. */
  call(method: string, args: readonly unknown[]): Promise<unknown>;
  /** Rejects, naming the method, at the first call the fake cannot answer; never resolves. */
  readonly unanswered: Promise<never>;
  /** Put the fake on `page` as window.storytree, before the page's own scripts run. */
  install(page: Page): Promise<void>;
  /** Wait until `page`'s body reads data-state=ready, failing at once on an unanswered call. */
  ready(page: Page, timeoutMs?: number): Promise<void>;
}

/** A fake bridge answering with `answers`, typed against the desktop app's own bridge. */
export function fakeBridge(answers: Partial<StorytreeBridge>): FakeBridge {
  let refuse!: (error: Error) => void;
  const unanswered = new Promise<never>((_, reject) => (refuse = reject));
  unanswered.catch(() => {});
  const methods = answers as Record<string, ((...args: unknown[]) => unknown) | undefined>;

  const call = async (method: string, args: readonly unknown[]) => {
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
    unanswered,
    async install(page) {
      await page.exposeFunction("storytreeFakeBridge", call);
      await page.addInitScript(() => {
        const carry = (window as unknown as { storytreeFakeBridge: (method: string, args: unknown[]) => Promise<unknown> }).storytreeFakeBridge;
        // `then` stays unanswered so that awaiting the bridge itself is not mistaken for a call.
        (window as unknown as { storytree: unknown }).storytree = new Proxy({}, { get: (_, method) => (method === "then" ? undefined : (...args: unknown[]) => carry(String(method), args)) });
      });
    },
    async ready(page, timeoutMs = 60_000) {
      await Promise.race([page.waitForFunction(() => document.body.dataset.state === "ready", undefined, { timeout: timeoutMs }), unanswered]);
    },
  };
}

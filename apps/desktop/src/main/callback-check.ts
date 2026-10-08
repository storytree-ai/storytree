/**
 * Capability 1 · Lifecycle. Where a sign-in callback deep link goes once it reaches the running app (contract 1.15):
 * with no sign-in offered it is dropped, before the sign-in session is made it is kept for it, and after, the session
 * gets it. Under `--callback-check`, each one is reported on a line, so CI can see that a later start's callback reached
 * the first instance without a live sign-in; the line names the link's scheme and path, never its code.
 */
export type CallbackRoute = "dropped" | "kept" | "delivered";

export interface CallbackRouting {
  /** Whether this build offers sign-in. */
  offered: boolean;
  /** The sign-in session, once it is made. */
  session: { callback(url: string): Promise<void> } | undefined;
  /** Callbacks kept until the session is made. */
  early: string[];
  /** Under --callback-check, where each callback's line goes. */
  report?: ((line: string) => void) | undefined;
}

export function routeCallback(url: string, { offered, session, early, report }: CallbackRouting): CallbackRoute {
  const route: CallbackRoute = !offered ? "dropped" : session === undefined ? "kept" : "delivered";
  if (route === "kept") early.push(url);
  if (route === "delivered") {
    void session!.callback(url).catch((error: unknown) => console.error(`sign-in callback: ${error instanceof Error ? error.message : String(error)}`));
  }
  report?.(`sign-in callback received: ${withoutQuery(url)}; ${OUTCOME[route]}`);
  return route;
}

const OUTCOME: Record<CallbackRoute, string> = {
  dropped: "this build offers no sign-in, so no sign-in session takes it",
  kept: "kept until the sign-in session is made",
  delivered: "reached the sign-in session",
};

function withoutQuery(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

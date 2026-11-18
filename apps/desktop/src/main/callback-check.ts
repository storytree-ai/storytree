// Capability 1 · Lifecycle
import type { AppArgs } from "./args.js";

export type CallbackRoute = "dropped" | "kept" | "delivered";

export interface CallbackRouting {
  offered: boolean;
  session: { callback(url: string): Promise<void> } | undefined;
  early: string[];
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

export function registersSignInScheme(args: Pick<AppArgs, "smoke" | "startCheck">, offered: boolean): boolean {
  return offered && !args.smoke && !args.startCheck;
}

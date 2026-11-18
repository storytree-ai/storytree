// Capability 1 · Lifecycle
import { callbackUrls } from "@storytree/project-and-caller/identity/desktop";

import { parseArgs } from "./args.js";

interface Preventable {
  preventDefault(): void;
}

export interface AppEvents {
  on(event: "second-instance", listener: (event: unknown, argv: string[]) => void): unknown;
  on(event: "open-url", listener: (event: Preventable, url: string) => void): unknown;
  on(event: "activate" | "window-all-closed", listener: () => void): unknown;
  on(event: "before-quit", listener: (event: Preventable) => void): unknown;
}

export interface Signals {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface EventLifecycle {
  secondStart(request?: { quit?: boolean }): "show" | "reopen" | "quit";
  windowClosed(): "keep-running";
  quit(code?: number): Promise<void>;
}

export function answerAppEvents(app: AppEvents, signals: Signals, { deliver, lifecycle, showWindow, quitApp }: {
  deliver(url: string): void;
  lifecycle: EventLifecycle;
  showWindow(): void;
  quitApp(): void;
}): void {
  app.on("second-instance", (_event, argv) => {
    for (const url of callbackUrls(argv)) deliver(url);
    if (lifecycle.secondStart({ quit: parseArgs(argv).quit }) === "show") showWindow();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliver(url);
  });
  app.on("activate", () => showWindow());
  app.on("window-all-closed", () => lifecycle.windowClosed());
  app.on("before-quit", (event) => {
    event.preventDefault();
    void lifecycle.quit();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) signals.on(signal, () => quitApp());
}

export function answerCallbackCheckEvents(app: AppEvents, signals: Signals, { deliver, exit }: { deliver(url: string): void; exit(code: number): void }): void {
  app.on("second-instance", (_event, argv) => {
    for (const url of callbackUrls(argv)) deliver(url);
    if (parseArgs(argv).quit) exit(0);
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliver(url);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) signals.on(signal, () => exit(0));
}

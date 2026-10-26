/**
 * Capability 1 · Lifecycle. What the app does on Electron's app events and the process's signals, kept out of main.ts so a
 * test drives each with a stand-in: a second start, the dock's activate, the last window closing, quitting, and a sign-in
 * callback arriving as a second start's argument or as open-url (contracts 1.7, 1.15, 1.27).
 */
import { callbackUrls } from "@storytree/project-and-caller/identity/desktop";

import { parseArgs } from "./args.js";

/** An event whose default Electron lets a listener prevent. */
interface Preventable {
  preventDefault(): void;
}

/** The app events these answer, as Electron's app emits them. */
export interface AppEvents {
  on(event: "second-instance", listener: (event: unknown, argv: string[]) => void): unknown;
  on(event: "open-url", listener: (event: Preventable, url: string) => void): unknown;
  on(event: "activate" | "window-all-closed", listener: () => void): unknown;
  on(event: "before-quit", listener: (event: Preventable) => void): unknown;
}

/** The process's signals that end the app. */
export interface Signals {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

/** The part of the app's lifecycle (@storytree/app's background) its events reach. */
export interface EventLifecycle {
  secondStart(request?: { quit?: boolean }): "show" | "reopen" | "quit";
  windowClosed(): "keep-running";
  quit(code?: number): Promise<void>;
}

/**
 * A normal start: a second start or the dock shows the window (a start while quitting is held by the lifecycle, not lost);
 * closing the last window leaves the app and its database running; quitting, by the tray or a signal, waits for the
 * lifecycle to stop the database before the app exits. Each sign-in callback goes to `deliver`.
 */
export function answerAppEvents(app: AppEvents, signals: Signals, { deliver, lifecycle, showWindow, quitApp }: {
  deliver(url: string): void;
  lifecycle: EventLifecycle;
  showWindow(): void;
  /** Electron's app.quit, which emits before-quit. */
  quitApp(): void;
}): void {
  app.on("second-instance", (_event, argv) => {
    // On Windows and Linux a sign-in's callback deep link arrives as a second start's argument.
    for (const url of callbackUrls(argv)) deliver(url);
    if (lifecycle.secondStart({ quit: parseArgs(argv).quit }) === "show") showWindow();
  });
  // On macOS it arrives as open-url, before the app is ready when it started the app.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliver(url);
  });
  app.on("activate", () => showWindow());
  app.on("window-all-closed", () => lifecycle.windowClosed());
  // Quitting waits for Postgres to stop; app.exit then ends the app without asking again.
  app.on("before-quit", (event) => {
    event.preventDefault();
    void lifecycle.quit();
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) signals.on(signal, () => quitApp());
}

/** A `--callback-check` start: hand over each callback a later start brings, and end on a later `--quit` or a signal. */
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

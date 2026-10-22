/** Capability 1 · Lifecycle. The window's own handlers: the page is the app, so it stays in its one window, which shows itself once ready (contract 1.28). */
export interface PageWindow {
  readonly webContents: {
    on(event: "will-navigate", listener: (event: { preventDefault(): void }) => void): unknown;
    setWindowOpenHandler(handler: () => { action: "deny" }): void;
  };
  isDestroyed(): boolean;
  show(): void;
  once(event: "ready-to-show", listener: () => void): unknown;
}

/** Keep the page from navigating away or opening other windows, and show the window once it is ready unless the app runs `headless` (the smoke check). */
export function keepPageInWindow(window: PageWindow, { headless }: { headless: boolean }): void {
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (headless) return;
  window.once("ready-to-show", () => {
    // Quitting destroys the window; a late ready must not reach it.
    if (!window.isDestroyed()) window.show();
  });
}

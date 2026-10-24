/** Capability 1 · Lifecycle. The window's own handlers: the page is the app, so it stays in its one window, which shows itself once ready (contract 1.28), and its session grants no web permission (contract 1.35). */
export interface PageWindow {
  readonly webContents: {
    on(event: "will-navigate", listener: (event: { preventDefault(): void }) => void): unknown;
    setWindowOpenHandler(handler: () => { action: "deny" }): void;
    readonly session: {
      setPermissionRequestHandler(handler: (contents: unknown, permission: unknown, callback: (granted: boolean) => void) => void): void;
      setPermissionCheckHandler(handler: () => boolean): void;
    };
  };
  isDestroyed(): boolean;
  show(): void;
  once(event: "ready-to-show", listener: () => void): unknown;
}

/** Keep the page from navigating away, opening other windows or being granted any permission, and show the window once it is ready unless the app runs `headless` (the smoke check). */
export function keepPageInWindow(window: PageWindow, { headless }: { headless: boolean }): void {
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // The page needs nothing a browser would ask the user for, so every request and check is refused.
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  if (headless) return;
  window.once("ready-to-show", () => {
    // Quitting destroys the window; a late ready must not reach it.
    if (!window.isDestroyed()) window.show();
  });
}

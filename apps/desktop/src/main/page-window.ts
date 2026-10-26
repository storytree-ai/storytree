/** Capability 1 · Lifecycle. The window's own handlers: the page is the app, so it stays in its one window, which shows itself once ready (contract 1.28), and its session grants no web permission but writing plain text to the clipboard (contract 1.35). */
export interface PageWindow {
  readonly webContents: {
    on(event: "will-navigate", listener: (event: { preventDefault(): void }) => void): unknown;
    setWindowOpenHandler(handler: () => { action: "deny" }): void;
    readonly session: {
      setPermissionRequestHandler(handler: (contents: unknown, permission: unknown, callback: (granted: boolean) => void) => void): void;
      setPermissionCheckHandler(handler: (contents: unknown, permission: unknown) => boolean): void;
    };
  };
  isDestroyed(): boolean;
  show(): void;
  once(event: "ready-to-show", listener: () => void): unknown;
}

/** Chromium's name for navigator.clipboard.writeText's permission: plain text, sanitised. */
const CLIPBOARD_WRITE = "clipboard-sanitized-write";

/** Keep the page from navigating away, opening other windows or being granted any permission but writing to the clipboard, and show the window once it is ready unless the app runs `headless` (the smoke check). */
export function keepPageInWindow(window: PageWindow, { headless }: { headless: boolean }): void {
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // The page needs nothing a browser would ask the user for but its copy buttons' clipboard write, so every
  // other request and check is refused, reading the clipboard included.
  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === CLIPBOARD_WRITE));
  window.webContents.session.setPermissionCheckHandler((_contents, permission) => permission === CLIPBOARD_WRITE);
  if (headless) return;
  window.once("ready-to-show", () => {
    // Quitting destroys the window; a late ready must not reach it.
    if (!window.isDestroyed()) window.show();
  });
}

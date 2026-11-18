// Capability 1 · Lifecycle
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

const CLIPBOARD_WRITE = "clipboard-sanitized-write";

export function keepPageInWindow(window: PageWindow, { headless }: { headless: boolean }): void {
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === CLIPBOARD_WRITE));
  window.webContents.session.setPermissionCheckHandler((_contents, permission) => permission === CLIPBOARD_WRITE);
  if (headless) return;
  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) window.show();
  });
}

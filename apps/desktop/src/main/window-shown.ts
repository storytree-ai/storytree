/** Capability 1 · Lifecycle. Bringing the window forward for a second start, the dock or the tray, opening it again if it was closed (contract 1.27). */
export interface ShownWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

/**
 * Restore, show and focus the first of `windows` still alive, or the one `open` opens when none is. While the app is
 * `stopping` nothing is touched: its windows are being destroyed, and a new one would outlive the library it reads.
 */
export function bringWindowForward(windows: readonly ShownWindow[], { stopping, open }: { stopping: boolean; open(): ShownWindow }): void {
  if (stopping) return;
  const window = windows.find((one) => !one.isDestroyed()) ?? open();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * Show the page at `query` (1.46, 1.47): every live window loads it again, and with none open, `open` opens one when it
 * is given: a start in the background (1.12) or a smoke check opens none, and the query waits for the window opened later.
 */
export function showPageQuery<Window extends { isDestroyed(): boolean }, Query>(
  windows: readonly Window[],
  query: Query,
  { load, open }: { load(window: Window, query: Query): void; open?: ((query: Query) => void) | undefined },
): void {
  const live = windows.filter((window) => !window.isDestroyed());
  for (const window of live) load(window, query);
  if (live.length === 0) open?.(query);
}

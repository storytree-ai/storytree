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

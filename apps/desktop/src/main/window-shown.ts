// Capability 1 · Lifecycle
export interface ShownWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export function bringWindowForward(windows: readonly ShownWindow[], { stopping, open }: { stopping: boolean; open(): ShownWindow }): void {
  if (stopping) return;
  const window = windows.find((one) => !one.isDestroyed()) ?? open();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function showPageQuery<Window extends { isDestroyed(): boolean }, Query>(
  windows: readonly Window[],
  query: Query,
  { load, open }: { load(window: Window, query: Query): void; open?: ((query: Query) => void) | undefined },
): void {
  const live = windows.filter((window) => !window.isDestroyed());
  for (const window of live) load(window, query);
  if (live.length === 0) open?.(query);
}

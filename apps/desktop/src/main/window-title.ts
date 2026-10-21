/** Capability 1 · Lifecycle. The window's title: the page names the project, and the title adds which build this is (contract 1.21). */
export interface TitledWindow {
  isDestroyed(): boolean;
  setTitle(title: string): void;
  on(event: "page-title-updated", listener: (event: { preventDefault(): void }, title: string) => void): unknown;
}

/** Title `window` with `build`, and keep the build on each title the page sets. */
export function titleWindow(window: TitledWindow, build: string): void {
  window.setTitle(`storytree 0.3 · ${build}`);
  window.on("page-title-updated", (event, title) => {
    event.preventDefault();
    // A late change (closing, quitting) can reach a window Electron has destroyed, whose setTitle throws.
    if (window.isDestroyed()) return;
    window.setTitle(build === "" ? title : `${title} · ${build}`);
  });
}

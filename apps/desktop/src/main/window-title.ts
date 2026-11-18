// Capability 1 · Lifecycle
export interface TitledWindow {
  isDestroyed(): boolean;
  setTitle(title: string): void;
  on(event: "page-title-updated", listener: (event: { preventDefault(): void }, title: string) => void): unknown;
}

export function titleWindow(window: TitledWindow, build: string): void {
  window.setTitle(`storytree 0.3 · ${build}`);
  window.on("page-title-updated", (event, title) => {
    event.preventDefault();
    if (window.isDestroyed()) return;
    window.setTitle(build === "" ? title : `${title} · ${build}`);
  });
}

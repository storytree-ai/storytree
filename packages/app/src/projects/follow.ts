/** Capability 2 · Storytree projects. Browser-safe project-list refresh; the forest's own live reading is independent. */
import type { ProjectsBridge } from "./bridge.js";
import type { ProjectSelection } from "./selection.js";

export type { ProjectSelection } from "./selection.js";

export function followProjects(options: {
  read: ProjectsBridge["projectSelection"];
  onChange(selection: ProjectSelection): void | Promise<void>;
  onError(error: unknown): void;
}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let last: string | undefined;

  function refresh(redraw = false): Promise<void> {
    if (pending !== undefined) return redraw ? pending.then(() => refresh(true)) : pending;
    if (stopped) return Promise.resolve();
    if (redraw) last = undefined;
    clearTimeout(timer);
    pending = options.read().then(async (selection) => {
      if (stopped) return;
      const next = JSON.stringify(selection);
      if (next !== last) {
        await options.onChange(selection);
        last = next;
      }
    }).catch((error: unknown) => {
      last = undefined;
      if (!stopped) options.onError(error);
    }).finally(() => {
      pending = undefined;
      if (!stopped) timer = setTimeout(() => void refresh(), 3000);
    });
    return pending;
  }

  void refresh();
  return {
    refresh,
    stop: () => { stopped = true; clearTimeout(timer); },
  };
}

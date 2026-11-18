// Capability 2 · Storytree projects
import type { PluginView } from "../page-operations.js";

export interface PluginViewContext {
  readonly project: string;
  readonly bridge: unknown;
}

interface ViewModule {
  mount(host: HTMLElement, context: PluginViewContext): { stop(): void } | (() => void) | void;
}

export async function mountPluginViews(
  host: HTMLElement,
  views: readonly PluginView[],
  on: (surface: string) => boolean,
  context: PluginViewContext,
): Promise<{ stop(): void; failed: { surface: string; why: string }[] }> {
  const stops: (() => void)[] = [];
  const failed: { surface: string; why: string }[] = [];
  for (const { surface, url } of views.filter((view) => on(view.surface))) {
    try {
      const module = await import(url) as Partial<ViewModule>;
      if (typeof module.mount !== "function") throw new Error(`${url} exports no mount(host, context)`);
      const mounted = module.mount(host, context);
      if (typeof mounted === "function") stops.push(mounted);
      else if (mounted !== undefined) stops.push(() => mounted.stop());
    } catch (error) {
      failed.push({ surface, why: error instanceof Error ? error.message : String(error) });
    }
  }
  return { stop: () => { for (const stop of stops.splice(0)) stop(); }, failed };
}

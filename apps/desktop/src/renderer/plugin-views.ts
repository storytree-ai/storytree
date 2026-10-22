/**
 * Capability 2 · Storytree projects. The views of the factory plugins standing in for switched-off parts (plugin loader
 * capability 5): the page's script is bundled, so a view, an ES module the plugin exports, is imported at run time from
 * where the window serves it, and mounted on the page while its surface is on, with the project on show and the bridge.
 * A view that cannot be loaded is said, and the rest still mount.
 */
import type { PluginView } from "../page-operations.js";

/** What a view is handed: the project on show and the page's bridge, storytree's interface to it (ADR-1112). */
export interface PluginViewContext {
  readonly project: string;
  readonly bridge: unknown;
}

/** A view's module: `mount` draws it on the host and may return how to stop it. */
interface ViewModule {
  mount(host: HTMLElement, context: PluginViewContext): { stop(): void } | (() => void) | void;
}

/** Mount each of `views` whose surface `on` says is on, each imported where the window serves it; stop takes them all away. */
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

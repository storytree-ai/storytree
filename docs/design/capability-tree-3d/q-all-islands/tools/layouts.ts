/** Round 13's arrangements (layouts/<name>.json, written by tools/layout.ts), one picked by `?layout=<name>`. Rollout 1: each
 * story's island has its own, named by its story id, and the page draws the selected story's (story.ts) by default.
 * build.mjs writes layouts.gen.ts, which imports every one of them. */
import { LAYOUTS } from "./layouts.gen.ts";
import { STORY } from "./story.ts";

type P = { x: number; z: number };
/** Where sea roads come ashore: `at` where the island's road ends, `sea` a point out to sea from it, the open land's `reach`
 * round it, the lanes it carries (`from->to`, capability ids) and how many of them reach land here. */
export type Dock = { at: P; sea: P; reach: number; lanes: string[]; load: number };
export type Layout = {
  story: string; owners: string[]; docks: Dock[];
  /** Rollout 1: cut with every capability holding land (layout-core.ts's withCodeless). */
  codeless?: boolean;
  /** The island's scale against The library's (layout-core.ts's islandScale); every point here is in The library's units. */
  scale?: number;
  open: { band: number; mouth: number }; landings: { capability: string; at: P; links: number; dock?: number }[]; net?: Record<string, number>;
};
const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("layout");
export const layoutName = asked && asked in LAYOUTS ? asked : STORY in LAYOUTS ? STORY : undefined;
export const layout = layoutName === undefined ? undefined : LAYOUTS[layoutName as keyof typeof LAYOUTS] as unknown as Layout;

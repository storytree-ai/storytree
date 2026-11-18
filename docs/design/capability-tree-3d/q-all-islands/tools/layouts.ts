import { LAYOUTS } from "./layouts.gen.ts";
import { STORY } from "./story.ts";

type P = { x: number; z: number };
export type Dock = { at: P; sea: P; reach: number; lanes: string[]; load: number };
export type Layout = {
  story: string; owners: string[]; docks: Dock[];
  codeless?: boolean;
  scale?: number;
  open: { band: number; mouth: number }; landings: { capability: string; at: P; links: number; dock?: number }[]; net?: Record<string, number>;
};
const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("layout");
export const layoutName = asked && asked in LAYOUTS ? asked : STORY in LAYOUTS ? STORY : undefined;
export const layout = layoutName === undefined ? undefined : LAYOUTS[layoutName as keyof typeof LAYOUTS] as unknown as Layout;

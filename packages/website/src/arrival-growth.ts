/** Capability 2 · The forest on the site. The framed map's arrival: storytree's saved map drawing itself from a point (2.32). */
import { growthPlan, type GrowthPlan } from "@storytree/forest-world/planet";
import type { TourSnapshot } from "./forest-data.js";

/**
 * The saved map as one stage, grown the way the old home page's arrival grew it: the globe swells from a point of light, then
 * each island rises and each road draws on, in about twelve seconds; after it the map is free play. Each road draws at a typical
 * road's pace: measuring its true length means routing every road on the page's thread, seconds the canvas's worker spends anyway.
 */
export function arrivalGrowth(snapshot: Pick<TourSnapshot, "scene" | "capturedAt">, seconds = 12): GrowthPlan {
  return growthPlan([{ scene: snapshot.scene, at: snapshot.capturedAt }], { fromPoint: true, seconds });
}

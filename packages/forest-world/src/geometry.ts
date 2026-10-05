// @storytree/forest-world/geometry: the ground, coast and pathway geometry beneath the drawn
// scene, for the forest to check what it draws against (ADR-0805 D1: the world is a story, so
// no other package reaches into its files).
export { parcelCellsFrom } from "./parcel-cells.js";
export { clipToCoast, rimLoops, SHIPPED_COAST } from "./coast-clip.js";
export { plateTransform, PLATE_CLEARANCE } from "./planet/planet.js";
export { islandSurface } from "./planet/island-surface.js";
export { buildPlanetPathways, islandCoastReach, planetPathwayDrawing } from "./planet/pathways.js";
export { routeTrails, trailFillWidth } from "./core/routing.js";
export { laneDrawSeconds, laneProgress, laneRoutes, LANE_COLOUR, type LaneRoute, type LitLink } from "./planet/lanes.js";
export { RIBBON_GROUND_SCALE } from "./trail-ribbon-width.js";
export { crossingLength, fileKey, growthMoment, growthPlan, growthProgress, linkKey, plateGrowth, roadSegmentWindows, segmentDrawRange, type GrowthOptions, type GrowthPlan, type GrowthStage, type GrowthWindow } from "./planet/growth.js";

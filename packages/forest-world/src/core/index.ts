// The drawing engine's geometry core, from 0.2's forest-world (ADR-0093): pure, browser-safe,
// deterministic geometry, data in and geometry out. The hex lattice, the relaxed mesh, the smoothed
// coast and the trail router under the globe's islands. 0.2's 2D scene graph, its trees, plants
// and flora went with the flat canvas (ADR-0920).

export { hash, rand01 } from './rng.js';


// The land's ONE declared camera (ADR-0367 D1) — read by the land's coordinate mapping below and,
// across the package boundary, by the object sprites that stand on it.
export {
  LAND_CAMERA_ELEVATION_DEG,
  PLAN_VIEW_ELEVATION_DEG,
  groundFlattening,
  uprightForeshortening,
  projectGround,
  unprojectGround,
} from './camera.js';

export {
  type Pt,
  type Axial,
  HEX_R,
  HEX_W,
  HEX_AREA,
  HEX_UNIT_AREA,
  HEX_TILES_PER_CAPABILITY,
  LAND_AREA_PER_CAPABILITY,
  PRE_ADR0528_TILE,
  TILE_QUOTA_RULE,
  TILE_SCALE,
  tileUnits,
  axialKey,
  AXIAL_DIRS,
  hexCenter,
  pixelToHex,
  hexDist,
  hexCorners,
  polyPath,
} from './hex.js';

export { ringsOf, tileQuota } from './sizing.js';

export {
  type BoundarySeg,
  COAST_OUTSET,
  COAST_OUTSET_ON_TILE,
  COAST_SMOOTH_ITERS,
  boundaryRingLoops,
  jitteredOutset,
  loopSignedArea,
  outsetLoop,
  chaikinClosed,
  smoothCoast,
} from './coast.js';

export {
  type SubstrateMode,
  type SubstrateTuning,
  type RelaxedCell,
  type DrawTile,
  MESH_TUNING,
  buildRelaxedCells,
} from './substrate.js';

export {
  type TrailIsland,
  type TrailEdgeIn,
  type TrailTuning,
  type TrailSegment,
  type TrailCave,
  type TrailEdgeOut,
  type TrailNetwork,
  routeTrails,
  projectTrailNetwork,
  trailFillWidth,
} from './routing.js';

/** The status a parcel's ground wears, folded from its capability's form by the forest's join. */
export type SceneStatus = 'healthy' | 'mapped' | 'proposed' | 'building' | 'unhealthy' | 'unknown';

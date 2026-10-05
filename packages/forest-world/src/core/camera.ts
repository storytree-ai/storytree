// The land's DECLARED CAMERA — ADR-0367 D1.
//
// ONE value, in degrees above the ground plane, read by BOTH the land's coordinate mapping and the
// object sprites that stand on it. Before this module the land had NO camera at all: `hexCenter`
// mapped axial coordinates to pixels with no y-scale, no elevation and no projection matrix, and
// every stage downstream — the relaxed substrate mesh, the coast, the scene builders — worked in
// that same untransformed space. The hero tree, meanwhile, was authored at an explicitly declared
// orthographic camera. So the app stood 20-degree objects on a plan-view ground, reconciled only by
// a display-only vertical squash on the round-3 lab's sprite box whose own source comment calls it
// "a comparison stand-in, never a solved camera".
//
// THE PROJECTION. Orthographic, at elevation θ above the ground plane. A ground-plane displacement
// away from the camera covers sin θ of the screen distance it would cover in plan view; an upright
// world height covers cos θ. That is exactly the sprite generator's own projection — `blender_tree.py`
// computes `sy = p[1]*sin(EL) + (p[2]-TZ)*cos(EL)` — which is what makes the two composable. The
// same θ on both sides, or the objects do not stand on the ground.
//
// WHY 20 DEGREES, ORIGINALLY — MEASURED, not inherited. ADR-0367 D1 left the value to this
// increment, and this is the record of why the FIRST choice landed on 20° — HISTORY now (the value
// moved; see below), kept because it is what made 20° the right pick at the time:
//   · The sprite track is authored at exactly 20.0° (`ELEV_DEG = 20.0`), and its 19 frames carry a
//     signed owner ceiling verdict, so they cannot be re-rendered at another angle for free.
//   · The land, though its MAPPING carried no camera, has always drawn its ground contact shadows
//     as though it had one. The eight fixed shadow ellipses in 0.2's `scene.ts` implied elevations of
//     14.9°, 17.5°, 17.5°, 19.0°, 19.1°, 20.4°, 21.5° and 23.6° — mean 19.2°, median 19.0°.
//   · So 20° sat ~0.8° from what the land's own existing art already implied, and well inside that
//     art's own 8.7° spread. Adopting the sprite's angle cost the land nothing measurable, and it
//     was the one angle at which the shipped sprites needed NO reconciliation whatsoever.
//   · The single real outlier was the story tree's own contact shadow at 14.9° (`rx = 0.78R,
//     ry = 0.20R` → 0.256, against sin 20° = 0.342) — the mark directly beneath the hero tree, and
//     precisely the mismatch the squash dial was absorbing.
//
// WHY 50 DEGREES NOW — ADR-0593 D1, owner-directed, 2026-09-22. The 3D land renderer's own viewport
// elevation (`RENDER_ELEV_DEG` / `SHIPPED_ELEVATION_DEG`, `packages/forest-world-r3f`) is a
// STRUCTURALLY SEPARATE constant that ADR-0517 D2 already raised 45° → 50°; `registrationCamera`
// will only stack the 3D ground under this flat map once `sin` of the two elevations agrees, so
// mounting the land on a real surface (ADR-0530) needed THIS constant to move to match, not the
// other way round. The owner had picked 50° for the 3D track back in August off a rendered
// 45-vs-50 comparison, and — shown that moving this constant to match also un-squashes every
// island by `sin 50° / sin 20° = 2.24×`, opening more room to place signals on each island at the
// cost of roughly half the forest overview's rows — took that trade deliberately for the island
// area it buys (ADR-0593 §Context, D2). The 20°-signed hero-tree sprite frames the section above
// used to reconcile against turned out NOT to be on the studio's working map (they sit behind the
// `chapter2Round3Lab` query parameter, a static witness stage rather than the product), so no
// re-render was owed there; the per-status hero-tree COLOURWAYS that ARE on the working map are a
// different asset whose authored angle this decision did not establish.
// `assertSpriteRenderMatchesLandCamera` stays the live guard against a stale angle anywhere else
// in the tree that still needs a re-render this move owes.
//
// RUNTIME 3D STAYS CLOSED (ADR-0367 D3). This is a projection SCALAR, computed here and applied to
// coordinates the app already owns. No 3D substrate, no second renderer, no asset-owned clock.

import type { Pt } from './hex.js';

const RAD = Math.PI / 180;

/**
 * Straight down. The elevation the land was implicitly drawn at while it had no camera, kept named
 * so "the pre-camera mapping" is expressible in a test rather than being a bare 90.
 */
export const PLAN_VIEW_ELEVATION_DEG = 90;

/**
 * The land's camera elevation, in DEGREES above the ground plane — the ONE value the land and the
 * objects standing on it both read (ADR-0367 D1). Moving it re-projects the land AND changes the
 * angle every object sprite must be re-rendered at. Nothing else may carry a second copy of it.
 */
export const LAND_CAMERA_ELEVATION_DEG = 50;

/** Ground-plane foreshortening at `elevationDeg`: sin θ. 1 in plan view, → 0 edge-on. */
export function groundFlattening(elevationDeg: number = LAND_CAMERA_ELEVATION_DEG): number {
  return Math.sin(elevationDeg * RAD);
}

/** Upright (world-height) foreshortening at `elevationDeg`: cos θ. 0 in plan view, → 1 edge-on. */
export function uprightForeshortening(elevationDeg: number = LAND_CAMERA_ELEVATION_DEG): number {
  return Math.cos(elevationDeg * RAD);
}

/**
 * Project a ground-plane point into screen space at the declared camera.
 *
 * ⚠ NEVER pass this point-free to `Array.prototype.map` — `pts.map(projectGround)` calls it as
 * `projectGround(p, index, array)`, silently feeding each point's ARRAY INDEX into `elevationDeg`
 * (the `hexCenter`/`['1','2'].map(parseInt)` trap, ADR-0367 D1). Always wrap:
 * `pts.map((p) => projectGround(p))`.
 */
export function projectGround(p: Pt, elevationDeg: number = LAND_CAMERA_ELEVATION_DEG): Pt {
  return { x: p.x, y: p.y * groundFlattening(elevationDeg) };
}

/**
 * The inverse of {@link projectGround}: screen space back onto the ground plane.
 *
 * ⚠ Same point-free `.map` trap as {@link projectGround} — never pass this bare to `.map`.
 */
export function unprojectGround(p: Pt, elevationDeg: number = LAND_CAMERA_ELEVATION_DEG): Pt {
  return { x: p.x, y: p.y / groundFlattening(elevationDeg) };
}


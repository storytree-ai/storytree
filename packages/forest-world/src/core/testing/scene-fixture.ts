// scene-fixture — the SHARED render-test fixture whose DEFAULT is the input set the SHIPPED STUDIO
// MAP actually sends (`render-fixtures-default-to-the-shipped-map`).
//
// WHY THIS EXISTS. `SceneInput` / `SceneTerritoryInput` carry a family of OPTIONAL, ABSENCE-LOCKED
// inputs: omit one and every island renders byte-for-byte as it did before the feature landed. Those
// locks are DELIBERATE and load-bearing — the public website's fold never sends them, and explicit
// regression tests pin them (the `parcels`-absent golden below the fixtures in `scene.test.ts`).
// Nothing here weakens a single lock.
//
// The defect this module fixes is the other half: the shipped studio ALWAYS supplies these inputs
// (`TreeView.territoryToScene` sends `parcels` for every island with capabilities), while every test
// fixture omitted them. So the shared default rendered the WEBSITE's art, and any assertion riding it
// was evidence about a path the studio map has not drawn in months — measured on the real 40-island
// corpus: 0 conifers, 0 one-plant-per-cap flora, 2,083 `parcel-flora` marks across 206 parcels.
//
// THE INVERSION. A fixture author now gets the shipped map by writing NOTHING, and reaches the legacy
// render only by NAMING it — {@link withoutParcels} / {@link legacyTerritory} / {@link legacyInput}.
// A test that pins the website's art therefore says so out loud.
//
// TWO GATES, both of which must stay open for the default to be honest (a one-gate fixture is still
// legacy): `buildScene` nulls every island's substrate cells when `SceneInput.relaxedCells` is null,
// AND `buildTerritorySurface` returns null when the territory carries no `parcels`. The defaults below
// close both.
//
// STILL NOT DEFAULTED, deliberately: `SceneInput.vegetation` (ADR-0226/ADR-0231 — the studio composes
// it always, so the default is not yet fully shipped-shaped), plus `uatCriteria` / `garden`, which are
// conditional on real story or session state rather than drifted defaults. `withVegetation` is the
// named opt-IN for the first of those.

import { routeTrails, type TrailIsland } from '../routing.js';
import { hash } from '../rng.js';
import type {
  SceneInput,
  SceneParcelInput,
  ScenePlantInput,
  SceneTerritoryInput,
  SceneTrailsInput,
  SceneVegetationInput,
  SurfaceTheme,
} from '../scene.js';

// ---------- routed trail fixture ----------

/** A trail-routing island literal. */
export const isle = (id: string, x: number, y: number, r: number): TrailIsland => ({ id, x, y, r });

/** The default territories' islands (library → cli), matching {@link shippedInput}. */
export const BASE_ISLANDS: TrailIsland[] = [isle('library', 100, 200, 60), isle('cli', 300, 60, 50)];

/** Trail fixtures are ROUTED, not hand-forged: real `routeTrails` output on a tiny island set (its own
 *  invariants are pinned in `routing.test.ts`). Computed once at module load — `routeTrails` is pure,
 *  so sharing the instance is safe. */
export const BASE_TRAILS: SceneTrailsInput = routeTrails(
  BASE_ISLANDS,
  [{ from: 'library', to: 'cli', title: 'cli depends on library' }],
  'scene-fixture',
);

// ---------- the shipped-map defaults ----------

const PARCEL_THEMES: readonly SurfaceTheme[] = ['meadow', 'woodland', 'heath'];

/** Mirrors the studio's `parcelTheme` (`TreeView.tsx`): a deterministic id-hashed country per
 *  capability, so a fixture's parcels vary the way the real map's do. */
function parcelTheme(capId: string): SurfaceTheme {
  return PARCEL_THEMES[hash(capId) % PARCEL_THEMES.length]!;
}

/** The shipped map's parcel fold, mirrored from `TreeView.capToParcel`: ONE parcel per capability,
 *  seeded at that capability's own layout position, tinted by ITS status. The fixture derives them
 *  from `plants` — the same array the studio derives both from — so a territory built with no
 *  capabilities stays parcels-ABSENT exactly as a capless island does on the real map. `testCount` is
 *  a fixed small density so fixture scenes stay readable; the real map's varies per capability. */
function parcelsFor(plants: readonly ScenePlantInput[]): SceneParcelInput[] {
  return plants.map((p) => ({
    capId: p.id,
    status: p.status,
    testCount: 4,
    theme: parcelTheme(p.id),
    seed: { x: p.x, y: p.y },
  }));
}

function baseTerritory(): SceneTerritoryInput {
  return {
    id: 'library',
    status: 'healthy',
    caps: 3,
    centroid: { x: 100, y: 200 },
    groundRadius: 60,
    screenRadius: 60,
    treeSpot: { x: 100, y: 190 },
    labelY: 260,
    coastGroundLoops: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]],
    decor: [{ x: 80, y: 180, seed: 7 }],
    plants: [{ id: 'library#cap-a', status: 'healthy', x: 90, y: 205, title: 'cap a — proven' }],
    treeTitle: 'library — healthy',
    wisps: [],
    claims: [],
    plate: { w: 120, h: 33, rx: 7, idY: 14, subY: 27, idText: 'library', subText: 'healthy · 3 caps', title: 'The library' },
  };
}

/**
 * One island shaped like the SHIPPED MAP's: everything the old fixture carried, PLUS the `parcels`
 * the studio sends for every island that has capabilities. `decor` and `plants` are kept populated on
 * purpose — the core RETIRES both for a parcels-present island, so a fixture that still carries them
 * proves the retirement rather than hiding behind empty arrays.
 *
 * An explicit `parcels` in `over` always wins (including the `undefined`-free strip
 * {@link withoutParcels} performs); otherwise parcels are derived from the resolved `plants`.
 */
export function shippedTerritory(over: Partial<SceneTerritoryInput> = {}): SceneTerritoryInput {
  const t: SceneTerritoryInput = { ...baseTerritory(), ...over };
  if ('parcels' in over) return t;
  const parcels = parcelsFor(t.plants);
  return parcels.length ? { ...t, parcels } : t;
}

/**
 * A whole scene shaped like the SHIPPED MAP's: `relaxedCells` non-null (the substrate gate) and every
 * capability-bearing territory carrying `parcels` (the parcel gate). Both gates must be open or the
 * default is still the website's render.
 */
export function shippedInput(over: Partial<SceneInput> = {}): SceneInput {
  return {
    offset: { x: 300, y: 400 },
    width: 1200,
    height: 1600,
    empties: [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ],
    relaxedCells: [
      { owner: 0, poly: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], variant: 1, wheat: false },
      { owner: 0, poly: [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }], variant: 2, wheat: true },
      { owner: 1, poly: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], variant: 0, wheat: false },
    ],
    drawTiles: [
      { h: { q: 0, r: 0 }, owner: 0 },
      { h: { q: 1, r: 0 }, owner: 1 },
    ],
    wheatSets: [new Set(['0,0']), new Set()],
    trails: BASE_TRAILS,
    territories: [
      shippedTerritory(),
      // The second island carries NO capabilities, so it stays parcels-ABSENT — not an oversight but
      // exactly what `TreeView.territoryToScene` does for a capless island (`t.caps.length` guards the
      // spread). The default scene therefore exercises both shipped shapes, with the parcel-bearing
      // island first.
      shippedTerritory({
        id: 'cli',
        caps: 2,
        centroid: { x: 300, y: 60 },
        treeSpot: { x: 300, y: 50 },
        plants: [],
        decor: [],
      }),
    ],
    ...over,
  };
}

// ---------- the NAMED opt-outs (the point of the inversion) ----------

/** Strip `parcels` from a territory — the named way to ask for the WEBSITE's render (conifer decor +
 *  the one-plant-per-cap ring). Absence-lock tests use this instead of relying on an omission. */
export function withoutParcels(t: SceneTerritoryInput): SceneTerritoryInput {
  const { parcels: _dropped, ...rest } = t;
  return rest;
}

/** A parcels-ABSENT island — {@link shippedTerritory} with the parcel gate deliberately shut. */
export function legacyTerritory(over: Partial<SceneTerritoryInput> = {}): SceneTerritoryInput {
  return withoutParcels(shippedTerritory(over));
}

/** A whole scene on the WEBSITE's render path: every territory parcels-absent. The `relaxedCells`
 *  substrate gate is left OPEN, so this isolates the parcel gate alone. */
export function legacyInput(over: Partial<SceneInput> = {}): SceneInput {
  const input = shippedInput(over);
  return { ...input, territories: input.territories.map(withoutParcels) };
}

// ---------- the named opt-IN still outstanding ----------

/** The unified vegetation vocabulary (ADR-0226/ADR-0231). The studio composes it on every render, but
 *  it is NOT yet part of the default here — this is the named opt-in until it is. */
export function withVegetation(
  input: SceneInput,
  vegetation: SceneVegetationInput = {},
): SceneInput {
  return { ...input, vegetation };
}

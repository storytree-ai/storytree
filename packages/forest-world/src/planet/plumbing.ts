/** Capability 4 · The planet. Plumbing roads (ADR-1085 D3): a build step, a cleanup or a forwarder drawn between the islands
 * it joins, never counted as a dependency. */
import type { Vector3 } from 'three';
import type { Plumbing, PlumbingKind } from '../scene.js';
import type { PlanetPathwaySegment, PlanetPathways } from './pathways.js';

export const plumbingKey = (_call: Pick<Plumbing, 'from' | 'to' | 'kind'>): string => '';
export const PLUMBING_KINDS: readonly PlumbingKind[] = [];
export interface PlumbingLabel { from: string; to: string; point: Vector3 | undefined; chips: { kind: PlumbingKind; files: readonly string[] }[] }
export function plumbingLabels(_plan: PlanetPathways): PlumbingLabel[] { return []; }
export interface RoadLook { road: string; halo: string; thread?: string; threadWidth?: number }
export function roadLook(_segment: PlanetPathwaySegment): RoadLook { return { road: '', halo: '' }; }

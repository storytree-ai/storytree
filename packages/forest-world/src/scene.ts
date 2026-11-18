// Capability 1 · Scene layout

export type TreeForm = "seedling" | "pale" | "green" | "dead";

export type CapabilityWord = "proposed" | "healthy" | "unhealthy" | "untested";

export const PLACE_WIDTH = 16;

export interface PlacedTree {
  capability: string | undefined;
  form: TreeForm;
  status?: CapabilityWord;
  contracts: number;
}

export interface Island {
  story: string;
  title: string;
  x: number;
  z: number;
  trees: PlacedTree[];
  land?: IslandLand;
  area?: number;
  key: string;
}

export interface IslandLand {
  territories: readonly { capability?: string; title?: string; description?: string; status?: CapabilityWord; parked?: true; mapped?: true; lines: number }[];
  files: readonly { path: string; lines: number; capability?: string }[];
}

export interface ForestScene {
  islands: Island[];
  links?: readonly { from: string; to: string; typeOnly?: true }[];
  plumbing?: readonly Plumbing[];
  stores?: readonly Store[];
}

export interface Store {
  address: string;
  medium: string;
  tables: readonly string[];
}

export type PlumbingKind = "build step" | "cleanup" | "forwarder";

export interface Plumbing {
  from: string;
  to: string;
  kind: PlumbingKind;
  files: readonly string[];
}

// Capability 1 · Scene layout

import { HEX_TILES_PER_CAPABILITY } from './hex.js';

export function tileQuota(capabilities: number): number {
  return Math.max(1, capabilities) * HEX_TILES_PER_CAPABILITY;
}

export function ringsOf(quota: number): number {
  return quota <= 1 ? 0 : quota <= 7 ? 1 : quota <= 19 ? 2 : 3;
}

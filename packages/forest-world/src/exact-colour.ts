// Capability 2 · Island ground

import * as THREE from 'three';

export interface ExactColourSettings {
  outputColorSpace: string;
  toneMapping: number;
  colorManagement: boolean;
}

export const EXACT_COLOUR: ExactColourSettings = {
  outputColorSpace: THREE.LinearSRGBColorSpace,
  toneMapping: THREE.NoToneMapping,
  colorManagement: false,
};

export const EXACT_COLOUR_CANVAS_PROPS = {
  legacy: !EXACT_COLOUR.colorManagement,
  linear: EXACT_COLOUR.outputColorSpace === THREE.LinearSRGBColorSpace,
  flat: EXACT_COLOUR.toneMapping === THREE.NoToneMapping,
} as const;

export interface ColourConfigurableRenderer {
  outputColorSpace: string;
  toneMapping: number;
}

export function configureExactColour(renderer: ColourConfigurableRenderer): void {
  renderer.outputColorSpace = EXACT_COLOUR.outputColorSpace;
  renderer.toneMapping = EXACT_COLOUR.toneMapping;
  THREE.ColorManagement.enabled = EXACT_COLOUR.colorManagement;
}

export function isExactColour(renderer: ColourConfigurableRenderer): boolean {
  return (
    renderer.outputColorSpace === EXACT_COLOUR.outputColorSpace &&
    renderer.toneMapping === EXACT_COLOUR.toneMapping &&
    THREE.ColorManagement.enabled === EXACT_COLOUR.colorManagement
  );
}

// Capability 1 · Lifecycle
import { nativeImage, type NativeImage } from "electron";

import { markIcon, type IconColourway } from "./app-icon.js";

export function createTrayIcon(colourway: IconColourway): NativeImage {
  const [small, large] = markIcon(colourway, [16, 32]);
  const image = nativeImage.createFromBuffer(small!.png, { scaleFactor: 1 });
  image.addRepresentation({ scaleFactor: 2, buffer: large!.png });
  return image;
}

export function createWindowIcon(colourway: IconColourway): NativeImage {
  return nativeImage.createFromBuffer(markIcon(colourway, [256])[0]!.png);
}

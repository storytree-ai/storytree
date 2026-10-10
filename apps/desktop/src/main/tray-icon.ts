/** Capability 1 · Lifecycle. The tray's and the window's icons: the mark (app-icon.ts) as Electron images. */
import { nativeImage, type NativeImage } from "electron";

import { markIcon, type IconColourway } from "./app-icon.js";

/** The tray icon: 16 pixels, with a 32-pixel picture for screens at twice the scale. */
export function createTrayIcon(colourway: IconColourway): NativeImage {
  const [small, large] = markIcon(colourway, [16, 32]);
  const image = nativeImage.createFromBuffer(small!.png, { scaleFactor: 1 });
  image.addRepresentation({ scaleFactor: 2, buffer: large!.png });
  return image;
}

/** The window's icon, which the taskbar shows for an unpackaged app. */
export function createWindowIcon(colourway: IconColourway): NativeImage {
  return nativeImage.createFromBuffer(markIcon(colourway, [256])[0]!.png);
}

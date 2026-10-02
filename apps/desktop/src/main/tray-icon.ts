/**
 * The tray icon: a 32x32 PNG of a green tree, inline so the packaged app needs no extra file.
 * Drawn by a throwaway script (a circle for the crown, a bar for the trunk); replace it freely.
 */
import { nativeImage, type NativeImage } from "electron";

export const TRAY_ICON_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAaElEQVR4nO3OoREAIAxDUSZCMAmaSRiHTcEiELRNrxXJXfR/pXCC1TX2z0PjcIQ0DIeEAqxxEwIVVyNCAei4GEEAAQR4IETxFAAkQhVHIUzxFAAtBBbWIFzi92Zv+3X3MAEEEJAGgNwBNQOMdNYpivEAAAAASUVORK5CYII=";

export function createTrayIcon(): NativeImage {
  return nativeImage.createFromDataURL(TRAY_ICON_PNG);
}

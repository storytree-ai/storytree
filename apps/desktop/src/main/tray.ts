/**
 * Capability 1 · Lifecycle. The tray icon, whose click and Open bring the window back and whose Quit quits the app
 * (contracts 1.7, 1.27), worn with the windows in the taskbar's colourway as it changes (contract 1.17).
 */
import { followTaskbar, type IconColourway, type TaskbarTheme } from "./app-icon.js";

/** The part of Electron's Tray this keeps, with its image and menu types left to the caller. */
export interface AppTray<Image, Menu> {
  isDestroyed(): boolean;
  setImage(image: Image): void;
  setToolTip(tip: string): void;
  setContextMenu(menu: Menu): void;
  on(event: "click", listener: () => void): unknown;
}

/** A window that wears the icon. */
export interface IconWindow<Image> {
  isDestroyed(): boolean;
  setIcon(image: Image): void;
}

/** Make the tray in the taskbar's colourway, wear each change on it and the live windows, and answer its click and menu. */
export function keepTray<Image, Menu, Made extends AppTray<Image, Menu>>({ theme, items, build, makeTray, trayIcon, windowIcon, windows, buildMenu, show, quit }: {
  theme: TaskbarTheme;
  items: readonly { id: "show" | "quit"; label: string }[];
  build: string;
  makeTray(image: Image): Made;
  trayIcon(colourway: IconColourway): Image;
  windowIcon(colourway: IconColourway): Image;
  windows(): readonly IconWindow<Image>[];
  buildMenu(items: { label: string; click: () => void }[]): Menu;
  show(): void;
  quit(): void;
}): Made {
  let tray: Made | undefined;
  followTaskbar(theme, (colourway) => {
    // A taskbar change can arrive while the app quits, after Electron has destroyed what wears the icon.
    if (tray === undefined) tray = makeTray(trayIcon(colourway));
    else if (!tray.isDestroyed()) tray.setImage(trayIcon(colourway));
    for (const window of windows()) if (!window.isDestroyed()) window.setIcon(windowIcon(colourway));
  });
  const made = tray!;
  made.setToolTip(`storytree 0.3 · ${build}`);
  const actions = { show, quit };
  made.setContextMenu(buildMenu(items.map((item) => ({ label: item.label, click: actions[item.id] }))));
  made.on("click", show);
  return made;
}

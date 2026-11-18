// Capability 3 · Story node render
import { placePins, type DrawnPlaces, type PinIcon, type PinPlace, type PinReading } from "@storytree/map/pins";

export type MarkedPin = { readonly id: string; readonly icon: PinIcon; readonly label: string; readonly stale?: string };

export type PinMark = {
  readonly key: string;
  readonly place: PinPlace;
  readonly count: number;
  readonly icons: readonly PinIcon[];
  readonly stale: number;
  readonly pins: readonly MarkedPin[];
};

export const placeKey = (place: PinPlace): string => "store" in place ? `store:${place.store}` : `${place.capability}/${place.part ?? ""}`;

export function pinMarks(readings: readonly PinReading[], drawn: DrawnPlaces): PinMark[] {
  const byId = new Map(readings.map((reading) => [reading.pin.id, reading]));
  return placePins(readings.map(({ pin }) => pin), drawn).map(({ place, count, pins }) => {
    const marked = pins.map((id): MarkedPin => {
      const { pin, stale } = byId.get(id)!;
      return { id, icon: pin.fields.icon, label: pin.fields.label, ...(stale === undefined ? {} : { stale }) };
    });
    return { key: placeKey(place), place, count, icons: [...new Set(marked.map(({ icon }) => icon))], stale: marked.filter(({ stale }) => stale !== undefined).length, pins: marked };
  });
}

export type BadgeShown = { readonly near: true; readonly rows: readonly MarkedPin[] } | { readonly near: false; readonly icons: readonly { readonly icon: PinIcon; readonly stale: boolean }[]; readonly count: number };

export function badgeShown(mark: PinMark, near: boolean): BadgeShown {
  if (near) return { near, rows: mark.pins };
  return { near, icons: mark.icons.map((icon) => ({ icon, stale: mark.pins.every((pin) => pin.icon !== icon || pin.stale !== undefined) })), count: mark.count };
}

export function markSpot(place: PinPlace, plates: readonly { readonly capability: string; readonly x: number; readonly z: number }[], parts: readonly { readonly part: string; readonly x: number; readonly z: number }[] | undefined): { readonly x: number; readonly z: number } | undefined {
  if ("store" in place) return undefined;
  const at = place.part === undefined ? plates.find((plate) => plate.capability === place.capability) : parts?.find((plate) => plate.part === place.part);
  return at === undefined ? undefined : { x: at.x, z: at.z };
}

export const PIN_ICONS: Readonly<Record<PinIcon, string>> = {
  cache: "M13 2 4 14h7l-1 8 9-12h-7z",
  queue: "M4 6h16M4 12h16M4 18h16",
  store: "M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0zM4 6c0 2 16 2 16 0M4 12c0 2 16 2 16 0",
  api: "M8 6 2 12l6 6M16 6l6 6-6 6",
  auth: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  config: "M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M7 16v4",
  job: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3",
  events: "M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM15 15l6 6",
  logging: "M6 2h9l4 4v16H6zM9 9h7M9 13h7M9 17h5",
  flag: "M5 22V3M5 4h12l-3 4 3 4H5",
};

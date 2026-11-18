// Capability 9 · Agents' pins
import type { FieldsOf, SchemaRecord, SharedStore, StoreLink, StorySurvey, SurveyedPart } from "@storytree/library";

import { linkedStores } from "../code-survey/stores.js";

export type PinAnchor = FieldsOf<"pin">["anchor"];
export type PinIcon = FieldsOf<"pin">["icon"];
export type Pin = SchemaRecord<"pin">;

export const PIN_ICON_NAMES = ["cache", "queue", "store", "api", "auth", "config", "job", "events", "search", "logging", "flag"] as const satisfies readonly PinIcon[];

export const PIN_CAP = 3;

export interface PinWorld {
  readonly capability: (id: string) => { readonly files: readonly string[]; readonly parts: readonly SurveyedPart[]; readonly root: string } | undefined;
  readonly stores: readonly SharedStore[];
  readonly readText: (file: string) => Promise<string | undefined>;
}

export interface PinShelf {
  readonly list: () => Promise<readonly Pin[]>;
  readonly record: (pin: Omit<FieldsOf<"pin">, "at">) => Promise<Pin>;
  readonly get: (id: string) => Promise<{ readonly type: string } | null>;
  readonly retire: (id: string, reason: string) => Promise<void>;
}

export function parseAnchor(words: string): PinAnchor | undefined {
  const text = words.trim();
  const hash = text.lastIndexOf("#");
  const [head, tail] = hash < 0 ? [text, undefined] : [text.slice(0, hash), text.slice(hash + 1)];
  if (tail !== undefined && tail.trim() === "") return undefined;
  if (head.startsWith("store:")) {
    const store = head.slice(6).trim();
    return store === "" ? undefined : { store, ...(tail === undefined ? {} : { table: tail.trim() }) };
  }
  const slash = head.indexOf("/");
  const capability = (slash < 0 ? head : head.slice(0, slash)).trim();
  const part = slash < 0 ? undefined : head.slice(slash + 1).replace(/^\/+|\/+$/g, "").trim();
  if (!/^capability_[0-9a-f]+$/.test(capability) || part === "") return undefined;
  return { capability, ...(part === undefined ? {} : { part }), ...(tail === undefined ? {} : { name: tail.trim() }) };
}

export function anchorWords(anchor: PinAnchor): string {
  if ("store" in anchor) return `store:${anchor.store}${anchor.table === undefined ? "" : `#${anchor.table}`}`;
  return `${anchor.capability}${anchor.part === undefined ? "" : `/${anchor.part}`}${anchor.name === undefined ? "" : `#${anchor.name}`}`;
}

function placeOf(anchor: PinAnchor): string {
  return "store" in anchor ? `store:${anchor.store}` : `${anchor.capability}${anchor.part === undefined ? "" : `/${anchor.part}`}`;
}

function partAt(parts: readonly SurveyedPart[], folder: string): SurveyedPart | undefined {
  for (const part of parts) {
    if (part.folder === folder) return part;
    if (folder.startsWith(`${part.folder}/`)) return partAt(part.parts, folder);
  }
  return undefined;
}

const filesIn = (part: SurveyedPart): string[] => [...part.files, ...part.parts.flatMap(filesIn)];

const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function exportsName(text: string, name: string): boolean {
  const word = escaped(name);
  return new RegExp(`\\bexport\\s+(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:abstract\\s+)?(?:function\\*?|class|const|let|var|interface|type|enum|namespace)\\s+${word}\\b`).test(text)
    || new RegExp(`\\bexport\\s*(?:type\\s*)?\\{[^}]*\\b${word}\\b[^}]*\\}`).test(text)
    || new RegExp(`^(?:async\\s+)?(?:def|class)\\s+${word}\\b|^${word}\\s*(?::[^=\\n]*)?=`, "m").test(text)
    || new RegExp(`__all__\\s*=\\s*[[(][^\\])]*["']${word}["']`).test(text);
}

export async function unresolved(anchor: PinAnchor, world: PinWorld): Promise<string | undefined> {
  if ("store" in anchor) {
    const store = world.stores.find(({ address }) => address === anchor.store);
    if (store === undefined) return `no shared store ${anchor.store} is found${world.stores.length === 0 ? "" : ` (the stores: ${world.stores.map(({ address }) => address).join(", ")})`}`;
    if (anchor.table !== undefined && !store.tables.some(({ name }) => name === anchor.table)) return `${anchor.store} has no table ${anchor.table}`;
    return undefined;
  }
  const capability = world.capability(anchor.capability);
  if (capability === undefined) return `no capability ${anchor.capability} is in the plan`;
  let files = capability.files;
  if (anchor.part !== undefined) {
    const part = partAt(capability.parts, anchor.part);
    if (part === undefined) return `${anchor.capability} has no part ${anchor.part}`;
    files = filesIn(part);
  }
  if (anchor.name !== undefined) {
    for (const file of files) {
      const text = await world.readText(`${capability.root}/${file}`);
      if (text !== undefined && exportsName(text, anchor.name)) return undefined;
    }
    return `no file of ${anchor.part ?? anchor.capability} exports ${anchor.name}`;
  }
  return undefined;
}

export interface PinInput {
  readonly anchor: PinAnchor;
  readonly icon: PinIcon;
  readonly label: string;
  readonly evidence: string;
  readonly commit: string;
}

export type PinWritten = { readonly ok: true; readonly pin: Pin } | { readonly ok: false; readonly refused: string };

export async function writePin(shelf: PinShelf, world: PinWorld, input: PinInput): Promise<PinWritten> {
  if (input.icon === "store" && !("store" in input.anchor)) {
    const stores = world.stores.map(({ address }) => `store:${address}`);
    return { ok: false, refused: `A store is pinned on the stores' drawing, not on a capability or part: anchor it on store:<address>${stores.length === 0 ? "; no capability links a shared store here yet" : `, one of ${stores.join(", ")}`}.` };
  }
  const why = await unresolved(input.anchor, world);
  if (why !== undefined) return { ok: false, refused: `Nothing to pin on ${anchorWords(input.anchor)}: ${why}.` };
  const place = placeOf(input.anchor);
  const there = (await shelf.list()).filter((pin) => placeOf(pin.fields.anchor) === place);
  if (there.length >= PIN_CAP) {
    return { ok: false, refused: `${place} already holds ${there.length} pins, the most one place holds: ${there.map((pin) => `${pin.id} (${pin.fields.label})`).join(", ")}. Retire one first.` };
  }
  return { ok: true, pin: await shelf.record(input) };
}

export interface PinReading {
  readonly pin: Pin;
  readonly stale?: string;
}

export async function readPins(shelf: PinShelf, world: PinWorld): Promise<PinReading[]> {
  const pins = [...(await shelf.list())].sort((one, other) => one.id.localeCompare(other.id));
  return Promise.all(pins.map(async (pin) => {
    const stale = await unresolved(pin.fields.anchor, world);
    return stale === undefined ? { pin } : { pin, stale };
  }));
}

export async function retirePin(shelf: PinShelf, id: string, reason: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly refused: string }> {
  if ((await shelf.get(id))?.type !== "pin") return { ok: false, refused: `${id} is no live pin.` };
  await shelf.retire(id, reason);
  return { ok: true };
}

export interface DrawnPlaces {
  readonly capabilities: ReadonlySet<string>;
  readonly parts?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly stores?: ReadonlySet<string>;
}

export type PinPlace = { readonly capability: string; readonly part?: string } | { readonly store: string };

export interface PlacedPins {
  readonly place: PinPlace;
  readonly count: number;
  readonly icons: readonly PinIcon[];
  readonly pins: readonly string[];
}

function drawnPlace(anchor: PinAnchor, drawn: DrawnPlaces): PinPlace | undefined {
  if ("store" in anchor) return drawn.stores?.has(anchor.store) ? { store: anchor.store } : undefined;
  if (!drawn.capabilities.has(anchor.capability)) return undefined;
  const parts = drawn.parts?.get(anchor.capability);
  for (let folder = anchor.part; folder !== undefined && folder !== ""; folder = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : undefined) {
    if (parts?.has(folder)) return { capability: anchor.capability, part: folder };
  }
  return { capability: anchor.capability };
}

export function placePins(pins: readonly Pin[], drawn: DrawnPlaces): PlacedPins[] {
  const places = new Map<string, { place: PinPlace; pins: Pin[] }>();
  for (const pin of [...pins].sort((one, other) => one.id.localeCompare(other.id))) {
    const place = drawnPlace(pin.fields.anchor, drawn);
    if (place === undefined) continue;
    const key = "store" in place ? `store:${place.store}` : `${place.capability}/${place.part ?? ""}`;
    const held = places.get(key) ?? { place, pins: [] };
    held.pins.push(pin);
    places.set(key, held);
  }
  return [...places.values()].map(({ place, pins: held }) => ({ place, count: held.length, icons: held.map(({ fields }) => fields.icon), pins: held.map(({ id }) => id) }));
}

export function pinLine({ pin, stale }: PinReading): string {
  const { icon, label, anchor, commit, evidence } = pin.fields;
  return `${pin.id}  [${icon}] ${label}  on ${anchorWords(anchor)}  at ${commit.slice(0, 12)}${stale === undefined ? "" : `  STALE: ${stale}`}\n    evidence: ${evidence}`;
}

export function pinWorldOf(stories: readonly { readonly id: string; readonly capabilities: readonly { readonly id: string; readonly storeLinks?: readonly StoreLink[] }[] }[], survey: Readonly<Record<string, StorySurvey>>, top: string, readText: PinWorld["readText"]): PinWorld {
  const storyOf = new Map(stories.flatMap((story) => story.capabilities.map(({ id }) => [id, story.id] as const)));
  return {
    capability(id) {
      const story = storyOf.get(id);
      if (story === undefined) return undefined;
      const surveyed = survey[story];
      return {
        files: (surveyed?.files ?? []).filter(({ capability }) => capability === id).map(({ path }) => path),
        parts: surveyed?.parts?.capabilities[id] ?? [],
        root: surveyed?.mapped?.folder ?? top,
      };
    },
    stores: linkedStores(stories),
    readText,
  };
}

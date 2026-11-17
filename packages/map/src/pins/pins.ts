/**
 * Capability 9 · Agents' pins: what an agent found, pinned on the map with its evidence and the commit it was checked at
 * (question_82b15d496b5b's option A).
 *
 * - A pin anchors on a capability, a nested part of it (by the part's folder, as the code survey names it), or an
 *   exported name in either; or on a shared store, or a table of it (ADR-1332): a pin a store would be goes to the
 *   stores' drawing, so the store icon is refused anywhere else.
 * - Its anchor is read against the current survey every time: a pin that no longer resolves reads stale, with why, and
 *   is never moved to a new anchor.
 * - At most PIN_CAP live pins share one place (a capability or part, or a store), so pins cannot pile up; any agent may
 *   retire one, giving a reason.
 * - Zoomed out, a pin sits on the deepest drawn place holding its anchor: its part, else the nearest drawn part around
 *   it, else its capability.
 */
import type { FieldsOf, SchemaRecord, SharedStore, StoreLink, StorySurvey, SurveyedPart } from "@storytree/library";

import { linkedStores } from "../code-survey/stores.js";

export type PinAnchor = FieldsOf<"pin">["anchor"];
export type PinIcon = FieldsOf<"pin">["icon"];
export type Pin = SchemaRecord<"pin">;

/** The preset icons, restated from the library's pin record, which this package does not load when it runs. */
export const PIN_ICON_NAMES = ["cache", "queue", "store", "api", "auth", "config", "job", "events", "search", "logging", "flag"] as const satisfies readonly PinIcon[];

/** The most live pins one place holds. */
export const PIN_CAP = 3;

/** What a pin's anchor is read against: each capability's survey and where its files are, and the shared stores. */
export interface PinWorld {
  /** The capability's files and nested parts in the current survey, and the folder its paths are from; undefined when the plan has no such capability. */
  readonly capability: (id: string) => { readonly files: readonly string[]; readonly parts: readonly SurveyedPart[]; readonly root: string } | undefined;
  readonly stores: readonly SharedStore[];
  /** A file's text, by its full path; undefined when it cannot be read. */
  readonly readText: (file: string) => Promise<string | undefined>;
}

/** Where pins are kept: the library's pin records. */
export interface PinShelf {
  readonly list: () => Promise<readonly Pin[]>;
  readonly record: (pin: Omit<FieldsOf<"pin">, "at">) => Promise<Pin>;
  readonly get: (id: string) => Promise<{ readonly type: string } | null>;
  readonly retire: (id: string, reason: string) => Promise<void>;
}

/**
 * The anchor the words name: `<capability>[/<part folder>][#<exported name>]`, or `store:<address>[#<table>]`.
 * Undefined when they name neither.
 */
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

/** The anchor in the words parseAnchor reads. */
export function anchorWords(anchor: PinAnchor): string {
  if ("store" in anchor) return `store:${anchor.store}${anchor.table === undefined ? "" : `#${anchor.table}`}`;
  return `${anchor.capability}${anchor.part === undefined ? "" : `/${anchor.part}`}${anchor.name === undefined ? "" : `#${anchor.name}`}`;
}

/** The place a pin counts against the cap at: its store, or its capability and part. */
function placeOf(anchor: PinAnchor): string {
  return "store" in anchor ? `store:${anchor.store}` : `${anchor.capability}${anchor.part === undefined ? "" : `/${anchor.part}`}`;
}

/** The part at `folder` among `parts`, however deep. */
function partAt(parts: readonly SurveyedPart[], folder: string): SurveyedPart | undefined {
  for (const part of parts) {
    if (part.folder === folder) return part;
    if (folder.startsWith(`${part.folder}/`)) return partAt(part.parts, folder);
  }
  return undefined;
}

const filesIn = (part: SurveyedPart): string[] => [...part.files, ...part.parts.flatMap(filesIn)];

const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `text` exports `name`: a JavaScript or TypeScript export, or a Python module's top-level definition or `__all__`. */
function exportsName(text: string, name: string): boolean {
  const word = escaped(name);
  return new RegExp(`\\bexport\\s+(?:default\\s+)?(?:declare\\s+)?(?:async\\s+)?(?:abstract\\s+)?(?:function\\*?|class|const|let|var|interface|type|enum|namespace)\\s+${word}\\b`).test(text)
    || new RegExp(`\\bexport\\s*(?:type\\s*)?\\{[^}]*\\b${word}\\b[^}]*\\}`).test(text)
    || new RegExp(`^(?:async\\s+)?(?:def|class)\\s+${word}\\b|^${word}\\s*(?::[^=\\n]*)?=`, "m").test(text)
    || new RegExp(`__all__\\s*=\\s*[[(][^\\])]*["']${word}["']`).test(text);
}

/** Why the anchor does not resolve in `world`, or undefined when it does. */
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

/** What pin new is given: the anchor, icon, label, evidence and the commit the agent checked it at. */
export interface PinInput {
  readonly anchor: PinAnchor;
  readonly icon: PinIcon;
  readonly label: string;
  readonly evidence: string;
  readonly commit: string;
}

/** pin new's answer: the pin written, or the refusal. */
export type PinWritten = { readonly ok: true; readonly pin: Pin } | { readonly ok: false; readonly refused: string };

/**
 * Record a pin (9.1), refusing (9.6) an anchor that does not resolve, naming what is missing, and a pin past the cap at
 * its place, naming those there; and (9.4) the store icon anywhere but on a store, naming the stores to anchor on.
 */
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

/** A pin as pin list reads it: live, or stale with why. */
export interface PinReading {
  readonly pin: Pin;
  readonly stale?: string;
}

/** Every live pin, each read against `world` (9.2): stale, with why, once its anchor no longer resolves. */
export async function readPins(shelf: PinShelf, world: PinWorld): Promise<PinReading[]> {
  const pins = [...(await shelf.list())].sort((one, other) => one.id.localeCompare(other.id));
  return Promise.all(pins.map(async (pin) => {
    const stale = await unresolved(pin.fields.anchor, world);
    return stale === undefined ? { pin } : { pin, stale };
  }));
}

/** Retire the pin `id` names (9.5), any agent may, saying why; an id that is no live pin is refused. */
export async function retirePin(shelf: PinShelf, id: string, reason: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly refused: string }> {
  if ((await shelf.get(id))?.type !== "pin") return { ok: false, refused: `${id} is no live pin.` };
  await shelf.retire(id, reason);
  return { ok: true };
}

/** What a drawing shows: its capabilities, the parts opened inside them, and its stores. */
export interface DrawnPlaces {
  readonly capabilities: ReadonlySet<string>;
  /** By capability, the folders of the parts drawn inside it. */
  readonly parts?: ReadonlyMap<string, ReadonlySet<string>>;
  readonly stores?: ReadonlySet<string>;
}

/** Where a drawing puts pins: a capability, a part in it, or a store. */
export type PinPlace = { readonly capability: string; readonly part?: string } | { readonly store: string };

/** The pins one drawn place holds, its own and those rolled up to it: how many, their icons and ids. */
export interface PlacedPins {
  readonly place: PinPlace;
  readonly count: number;
  readonly icons: readonly PinIcon[];
  readonly pins: readonly string[];
}

/** The drawn place holding `anchor`: its store; its part, else the nearest drawn part around it, else its capability (9.3, 9.4). */
function drawnPlace(anchor: PinAnchor, drawn: DrawnPlaces): PinPlace | undefined {
  if ("store" in anchor) return drawn.stores?.has(anchor.store) ? { store: anchor.store } : undefined;
  if (!drawn.capabilities.has(anchor.capability)) return undefined;
  const parts = drawn.parts?.get(anchor.capability);
  for (let folder = anchor.part; folder !== undefined && folder !== ""; folder = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : undefined) {
    if (parts?.has(folder)) return { capability: anchor.capability, part: folder };
  }
  return { capability: anchor.capability };
}

/**
 * Where each pin shows in a drawing (9.3, 9.4): grouped by the drawn place holding it, each place with the count and
 * icons of its pins, in the order of their ids; a pin whose capability or store is not drawn is not placed.
 */
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

/** A pin's line in pin list: its id, icon, label, anchor, commit and evidence, and stale with why. */
export function pinLine({ pin, stale }: PinReading): string {
  const { icon, label, anchor, commit, evidence } = pin.fields;
  return `${pin.id}  [${icon}] ${label}  on ${anchorWords(anchor)}  at ${commit.slice(0, 12)}${stale === undefined ? "" : `  STALE: ${stale}`}\n    evidence: ${evidence}`;
}

/** The world a checkout reads: each capability's files and parts in `survey`, by the plan's stories, and the stores their capabilities link. */
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

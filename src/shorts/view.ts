/** Capability 6 · Pixel-art shorts. What the storytree side's developer sees on his map (the owner's notes of 2026-10-19,
 * question_325b76dba4ae: "use the shopping website map"): the shop built with storytree, from the saved snapshot the website
 * already draws (shop-snapshot.json), with one story more, the wishlist he has just asked Claude for, pinned here as data. It is
 * drawn as the app draws a new story: one more island on the glass sheet, its parts not yet proven lit in the app's "asks for
 * attention" yellow; and his click opens the app's own capability graph of it (the forest's drill-down, laid out by its
 * layoutTree). Every name on screen is the plan's: the island he clicks, the parts its panel lists, the part he asks about. */
import type { AnnotatedCapability, AnnotatedStory, AnnotatedTree } from "@storytree/library";
import { drillDown, forestScene, layoutTree, type StoryPanel, type TreeLayout } from "@storytree/forest";
import { workStates } from "@storytree/arc-surface";
import { growthPlan, growthProgress } from "@storytree/forest-world/geometry";
import type { GrowthSnapshot } from "../forest-data.js";
import saved from "../shop-snapshot.json" with { type: "json" };
import { columnsOf, SMALL, wrap, type Beat, type Grounding, type Rect } from "./script.js";

const shop = saved as unknown as GrowthSnapshot;
if (!shop.reading) throw new Error("The shop's saved snapshot has no reading: its plan is needed to add the wishlist to it");

/** The wishlist story the developer asks for, as its plan stands once Claude has built it: four parts, each building on the
 * shop's own (its accounts, its product page, its cart), two proven and two not yet tested. It takes the free place at the end
 * of the shop's third row, so no island already on the sheet moves. */
export const WISHLIST = {
  story: "story_wishlist5e1f", title: "Wishlist", place: 2004,
  parts: [
    { id: "capability_wish5e1f0001", title: "1 · Wishlist store", status: "healthy", dependsOn: ["capability_6207ddb9a1aa"] },
    { id: "capability_wish5e1f0002", title: "2 · Heart button", status: "healthy", dependsOn: ["capability_wish5e1f0001", "capability_f29c62742cce"] },
    { id: "capability_wish5e1f0003", title: "3 · Wishlist page", status: "untested", dependsOn: ["capability_wish5e1f0001", "capability_ae20917d7a32"] },
    { id: "capability_wish5e1f0004", title: "4 · Move to cart", status: "untested", dependsOn: ["capability_wish5e1f0001", "capability_05589d74df4b"] },
  ],
} as const;

const passing = { reported: { state: "passing" }, verified: { state: "passing" } } as const;
const unchecked = { reported: { state: "not-checked" }, verified: { state: "not-checked" } } as const;
const wishlist = {
  id: WISHLIST.story, title: WISHLIST.title, description: "Shoppers save products for later and move them to the cart.", health: unchecked,
  capabilities: WISHLIST.parts.map(({ id, title, status, dependsOn }) => ({ id, title, description: "", proposed: false, dependsOn: [...dependsOn],
    contracts: [], status, health: status === "healthy" ? passing : unchecked })) as unknown as AnnotatedCapability[],
} as unknown as AnnotatedStory;

/** The shop's plan with the wishlist in it. */
export const PLAN: AnnotatedTree = { ...shop.reading.tree, stories: [...shop.reading.tree.stories, wishlist] };
const states = workStates([]), history = shop.changes ?? [];
type Part = { capability: string; title: string; status: string };
const scene = forestScene(PLAN, history, states, {}), mine = new Set<string>(WISHLIST.parts.map(part => part.id));
const drawn = scene.islands.find(each => each.story === WISHLIST.story);
if (!drawn?.land) throw new Error("The forest drew no island for the wishlist");
const island = drawn as typeof drawn & { land: { territories: Part[] } };

/** The saved shop as the short draws it: its own islands and roads as saved, and the wishlist's island where the forest drew it,
 * with a road from each of its parts to what it builds on. */
const roads = (scene.links ?? []).filter(link => mine.has(link.from));
export const snapshot = { ...shop, scene: { islands: [...shop.scene.islands, island], links: [...(shop.scene.links ?? []), ...roads] },
  places: [...shop.places, { id: WISHLIST.story, title: WISHLIST.title, reported: "not-checked", place: WISHLIST.place, at: { x: 1.5, y: -2 }, dependsOn: [] }] };
export const places = new Map(snapshot.places.map(place => [place.id, place.place]));
const number = (title: string) => Number(/^(\d+)/.exec(title)?.[1] ?? Infinity);

/** The island's panel, as the app's detail panel heads it: its title, then each of its parts in number order. */
export const PANEL = {
  story: WISHLIST.story,
  title: WISHLIST.title,
  description: String(wishlist.description ?? ""),
  parts: [...island.land.territories].sort((a, b) => number(a.title) - number(b.title)).map(({ title, status }) => ({ title, status })),
};

/** The part he asks Claude about: moving a saved item to the cart, built but not yet tested. */
const asked = PANEL.parts.find(part => /move to cart/i.test(part.title));
if (!asked) throw new Error(`The wishlist lists no move-to-cart part: ${PANEL.parts.map(part => part.title).join(", ")}`);
export const GROUNDING: Grounding = { island: PANEL.title, capability: asked.title };

/** The wishlist's capability graph, as the app lays it out (the forest's drill-down and layoutTree): its own parts and the shop's
 * parts they build on, each a card at the app's own size, what a part builds on below it. */
export const GRAPH: { panel: StoryPanel; layout: TreeLayout } = (() => {
  const panel = drillDown(PLAN, WISHLIST.story, states, history);
  if (!panel) throw new Error("The forest's drill-down has no panel for the wishlist");
  return { panel, layout: layoutTree(panel) };
})();

/** The forest's view as the short mounts it: the glass sheet tilted a step toward the eye from its tabletop rest, no nameplates
 * (the scene letters its own), drawn on a canvas four times the full screen's size (so its lit edges survive being shrunk). It
 * has two aims, both settled before the first frame: the whole shop's sheet, and, once he has clicked the wishlist, that island
 * close up, left of the panel, as the app flies to the island a click selects. */
export const MAP = { width: 912, height: 856, tilt: 1, aims: {
  sheet: { framing: 0.0015, sideOffset: 35, story: "story_b393a0c5a8de" },
  island: { framing: 0.0008, sideOffset: -120, story: WISHLIST.story },
} } as const;
export type Aim = keyof typeof MAP.aims;

/** The short's palette for the map: the forest's drawing, shrunk to the screen, is put into these colours, so it is pixel art
 * with hard edges like everything around it: the void past the sheet, the glass in three tones (its far side, its lit middle,
 * its lit rim), the roads in three beiges (so a thin road shrunk into the glass stays a road), the land's greens and the grey of
 * land not yet built, the yellow of land that asks for attention, and the selection's gold. */
export const MAP_PALETTE = ["#101418", "#18242d", "#22343f", "#7f95a3", "#6e6248", "#a8956a", "#e6d18c", "#4f6b3e", "#6f8f55", "#95af78",
  "#c2d69a", "#5c6670", "#8a94a0", "#3fae6a", "#c9a227", "#f2d16b", "#e5534b", "#ffd34d", "#e8eef0"] as const;
/** Puts RGBA pixels into `palette` in place: each pixel becomes the palette's nearest colour, fully opaque. */
export function quantiseInto(palette: readonly string[]): (pixels: Uint8ClampedArray) => void {
  const RGB = palette.map(hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]);
  return pixels => {
    for (let at = 0; at < pixels.length; at += 4) {
      let best = RGB[0]!, distance = Infinity;
      for (const colour of RGB) {
        const d = (pixels[at]! - colour[0]) ** 2 + (pixels[at + 1]! - colour[1]) ** 2 + (pixels[at + 2]! - colour[2]) ** 2;
        if (d < distance) [best, distance] = [colour, d];
      }
      pixels.set(best, at);
      pixels[at + 3] = 255;
    }
  };
}
/** Puts RGBA pixels into the map's palette in place. */
export const quantise = quantiseInto(MAP_PALETTE);

/** How the storytree side's map grows from a brand-new project: from the empty sheet, every stage of the shop's saved growth
 * (its first four stories planned, their land filling in as each pull request lands, the other four, the shop as saved), then
 * the wishlist, replayed by the forest's own growth (islands rising, roads drawing on) in `seconds`, starting `after` the cut to
 * the map so the empty sheet is seen first. */
export const GROW = { after: 0.4, seconds: 4.2 } as const;
export const GROWTH = growthPlan([...(shop.stages ?? []).map(({ id, at, scene }) => ({ id, at, scene })), { id: "wishlist", scene: snapshot.scene }],
  { seconds: GROW.seconds });

/** Seconds into the map's growth at `seconds`, while the beat it grows in plays; undefined outside it, where the map is whole. */
export function growthAt(beats: readonly Beat[], seconds: number): number | undefined {
  const grows = beats.find(beat => beat.grows);
  return grows && seconds >= grows.from && seconds < grows.to ? seconds - grows.from - GROW.after : undefined;
}

/** Whether an island has risen whole at `seconds`, and so is named on the map. */
export function risenAt(beats: readonly Beat[], seconds: number): (story: string) => boolean {
  const at = growthAt(beats, seconds);
  return story => at === undefined || growthProgress(GROWTH.islands.get(story), at, false) >= 1;
}

/** What the short hands the forest's view (`PlanetView`) at a moment: the shop's plan on the glass sheet, grown as far as
 * `growing` seconds into its growth when it is growing, the wishlist's island selected once he has clicked it, and nothing over it
 * the scene does not draw itself. */
export const mapProps = (selected: string | undefined, growing?: number) => ({ scene: snapshot.scene, places, selected, wisps: [] as const,
  library: false, surfaces: { nameplates: false, knowledgeCore: false }, growth: growing === undefined ? undefined : { plan: GROWTH, at: growing } });

/** When, into the beat he clicks in, the cursor lands on the island, its panel has opened, and the cursor reaches the panel's
 * button that opens its graph full size and presses it. */
export const CLICK_AT = 1.6, PANEL_AT = 1.9, OPENED = 0.15, POP_AT = 3.6, POPPED = 4.0;
/** When, into the graph's first beat, the cursor comes to rest on the part he will ask about. */
export const HOVER_AT = 1.2;

/** Seconds since he clicked the island, or undefined before he has. */
export function clickedFor(beats: readonly Beat[], seconds: number): number | undefined {
  const click = beats.find(beat => beat.clicks);
  return click && seconds >= click.from + CLICK_AT ? seconds - click.from - CLICK_AT : undefined;
}

/** The island selected on the map at `seconds`: the wishlist's, once he has clicked it. */
export const selectedAt = (beats: readonly Beat[], seconds: number) => clickedFor(beats, seconds) === undefined ? undefined : PANEL.story;

/** Where the view is aimed at `seconds`: at the whole sheet, until his click flies it to the island he clicked. */
export const aimAt = (beats: readonly Beat[], seconds: number): Aim => clickedFor(beats, seconds) === undefined ? "sheet" : "island";

/** How far the panel has slid in, 0 to 1. */
export function panelOpen(beats: readonly Beat[], seconds: number): number {
  const since = clickedFor(beats, seconds);
  return since === undefined ? 0 : Math.max(0, Math.min(1, (since - (PANEL_AT - CLICK_AT)) / OPENED));
}

/** Whether the cursor rests on the asked part's card in the graph. */
export function hovering(beats: readonly Beat[], seconds: number): boolean {
  const first = beats.find(beat => beat.app === "graph");
  return first !== undefined && seconds >= first.from + HOVER_AT;
}

/** The panel laid out in `box`, as the app's: its title, the story's description, then its capability graph in a frame with the
 * button that opens it full size at the frame's top right. */
export function layPanel(box: Rect): { title: { lines: string[]; box: Rect }; description: { lines: string[]; x: number; y: number }; frame: Rect; open: Rect } {
  const columns = columnsOf(box.width, SMALL.advance), lines = wrap(PANEL.title, columns);
  const title = { lines, box: { x: box.x + 3, y: box.y + 4, width: Math.max(...lines.map(line => line.length)) * SMALL.advance - 1, height: lines.length * SMALL.line - 1 } };
  const said = wrap(PANEL.description, columns), below = title.box.y + lines.length * SMALL.line + 3;
  const top = below + said.length * SMALL.line + 4, frame = { x: box.x + 3, y: top, width: box.width - 6, height: box.y + box.height - 4 - top };
  return { title, description: { lines: said, x: box.x + 3, y: below }, frame, open: { x: frame.x + frame.width - 11, y: frame.y + 2, width: 9, height: 9 } };
}

/** A part's title wrapped to `columns`, its number kept with the first word of its name ("6 · accounts", never "6 ·" alone). */
export function wrapTitle(title: string, columns: number): string[] {
  return wrap(glue(title), columns).map(line => line.replaceAll("\u2060", " "));
}
/** A part's title with its number and first word joined into one word (by word joiners, which wrap never breaks at). */
const glue = (title: string) => title.replace(/^(\d+) · (\S+)/, "$1\u2060·\u2060$2");
/** The longest run a title's wrap can never break, in characters. */
export function longestWord(title: string): number {
  return Math.max(...glue(title).split(/\s+/).map(word => word.length));
}

export type GraphCard = { id: string; title: string; story?: string; own: boolean; status: string; lines: string[]; box: Rect; asked: boolean };
export type GraphLink = { from: Rect; to: Rect };
/** The graph laid into `box`: the app's layout spread to fill it, across and down each in proportion (so its ranks keep their
 * order and their gaps); each card as wide as the layout makes it (in words, only shrunk to fit with no text in the panel's
 * small copy), centred where the layout puts it, and as tall as its strip and
 * three lines of its title, wrapped to its width (another story's card names its story in its strip); and an arrow from each part
 * to the one it builds on. */
export function layGraph(box: Rect, words = true): { cards: GraphCard[]; links: GraphLink[] } {
  const { layout } = GRAPH, across = box.width / layout.width, down = Math.min(box.height / layout.height, 3 * across);
  const top = box.y + Math.round((box.height - layout.height * down) / 2);
  const placed = new Map(layout.cards.map(card => {
    // Another story's card is widened, if it must be, to name its story whole in its strip.
    const width = words ? Math.max(Math.round(card.width * across), (card.story ?? "").length * SMALL.advance + 5, longestWord(card.title ?? "") * SMALL.advance + 5) : Math.max(3, Math.round(card.width * across)), height = words ? 9 + 3 * SMALL.line + 2 : Math.max(3, Math.round(card.height * across));
    const at = { x: box.x + Math.round((card.x + card.width / 2) * across - width / 2), y: top + Math.round((card.y + card.height / 2) * down - height / 2), width, height };
    const title = card.title ?? "", lines = wrapTitle(title, Math.floor((at.width - 4) / SMALL.advance)).slice(0, 3);
    return [card.id, { id: card.id, title, ...(card.story === undefined ? {} : { story: card.story }), own: card.own, status: card.status, lines, box: at,
      asked: title === asked!.title }] as const;
  }));
  const links = layout.links.flatMap(({ from, to }) => placed.has(from) && placed.has(to) ? [{ from: placed.get(from)!.box, to: placed.get(to)!.box }] : []);
  return { cards: [...placed.values()], links };
}

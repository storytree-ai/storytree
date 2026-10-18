/** Capability 6 · Pixel-art shorts. What the storytree side's developer sees on his map, from the saved snapshot the website
 * already draws, so every name on screen is a real one: the island he clicks (the website's own), the parts its panel lists,
 * the part he asks Claude about, and how the map is drawn: storytree's current glass sheet (ADR-1043, ADR-1059, ADR-1062),
 * by the forest's own view, resting at its tabletop tilt and aimed at the island. */
import type { TourSnapshot } from "../forest-data.js";
import saved from "../forest-snapshot.json" with { type: "json" };
import { columnsOf, SMALL, wrap, type Beat, type Grounding, type Rect } from "./script.js";

export const snapshot = saved as unknown as TourSnapshot;
export const places = new Map(snapshot.places.map(place => [place.id, place.place]));
type Part = { capability: string; title: string; status: string };
type Island = { story: string; title: string; land: { territories: Part[] } };

const islands = snapshot.scene.islands as unknown as Island[];

/** The island he clicks: the website, this package's own story. */
const WEBSITE = "story_769e230c466d";
const island = islands.find(each => each.story === WEBSITE);
if (!island) throw new Error(`The saved snapshot has no island for ${WEBSITE}, the website`);
const number = (title: string) => Number(/^(\d+)/.exec(title)?.[1] ?? Infinity);

/** The island's panel, as the app's detail panel shows it: its title, then each of its parts in number order. */
export const PANEL = {
  story: island.story,
  title: island.title,
  parts: [...island.land.territories].sort((a, b) => number(a.title) - number(b.title)).map(({ title, status }) => ({ title, status })),
};

/** The part he asks Claude about, among the panel's: the waitlist, which the opening has Claude build. */
const asked = PANEL.parts.find(part => /waitlist/i.test(part.title));
if (!asked) throw new Error(`The website's island lists no waitlist part: ${PANEL.parts.map(part => part.title).join(", ")}`);
export const GROUNDING: Grounding = { island: PANEL.title, capability: asked.title };

/** The forest's view as the short mounts it: the glass sheet at its tabletop tilt, no nameplates (the scene letters its own),
 * drawn on a canvas four times the full screen's size (so its lit edges survive being shrunk) and aimed once, before the
 * first frame, at the island two rows in front of the website's (the app setup's), close enough to read the islands and far enough to see the slab's corner and edge, with the
 * website left of where the panel opens. */
export const MAP = { width: 608, height: 512, aim: { framing: 0.0025, sideOffset: -60, story: "story_b91056a06337" } } as const;

/** The short's palette for the map: the forest's drawing, shrunk to the screen, is put into these colours, so it is pixel art
 * with hard edges like everything around it: the void past the sheet, the glass in three tones (its far side, its lit middle,
 * its lit rim), the roads in three beiges (so a thin road shrunk into the glass stays a road), the land's greens and the grey of land not yet built, and the selection's gold. */
export const MAP_PALETTE = ["#101418", "#18242d", "#22343f", "#7f95a3", "#6e6248", "#a8956a", "#e6d18c", "#4f6b3e", "#6f8f55", "#95af78",
  "#c2d69a", "#5c6670", "#8a94a0", "#3fae6a", "#c9a227", "#e5534b", "#ffd34d"] as const;
const RGB = MAP_PALETTE.map(hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)) as [number, number, number]);

/** Puts RGBA pixels into the map's palette in place: each pixel becomes the palette's nearest colour, fully opaque. */
export function quantise(pixels: Uint8ClampedArray): void {
  for (let at = 0; at < pixels.length; at += 4) {
    let best = RGB[0]!, distance = Infinity;
    for (const colour of RGB) {
      const d = (pixels[at]! - colour[0]) ** 2 + (pixels[at + 1]! - colour[1]) ** 2 + (pixels[at + 2]! - colour[2]) ** 2;
      if (d < distance) [best, distance] = [colour, d];
    }
    pixels.set(best, at);
    pixels[at + 3] = 255;
  }
}

/** What the short hands the forest's view (`PlanetView`) at a moment: the saved plan on the glass sheet, the website's island
 * selected once he has clicked it, and nothing over it the scene does not draw itself. */
export const mapProps = (selected: string | undefined) => ({ scene: snapshot.scene, places, selected, wisps: [] as const,
  library: false, surfaces: { nameplates: false, knowledgeCore: false } });

/** When, into the beat he clicks in, the cursor lands on the island, its panel has opened, and the cursor rests on the part
 * he will ask about. */
export const CLICK_AT = 1.6, PANEL_AT = 1.9, OPENED = 0.15, HOVER_AT = 3.2;

/** Seconds since he clicked the island, or undefined before he has. */
export function clickedFor(beats: readonly Beat[], seconds: number): number | undefined {
  const click = beats.find(beat => beat.clicks);
  return click && seconds >= click.from + CLICK_AT ? seconds - click.from - CLICK_AT : undefined;
}

/** The island selected on the map at `seconds`: the website's, once he has clicked it. */
export const selectedAt = (beats: readonly Beat[], seconds: number) => clickedFor(beats, seconds) === undefined ? undefined : PANEL.story;

/** How far the panel has slid in, 0 to 1. */
export function panelOpen(beats: readonly Beat[], seconds: number): number {
  const since = clickedFor(beats, seconds);
  return since === undefined ? 0 : Math.max(0, Math.min(1, (since - (PANEL_AT - CLICK_AT)) / OPENED));
}

/** Whether the cursor rests on the asked part's card. */
export function hovering(beats: readonly Beat[], seconds: number): boolean {
  const click = beats.find(beat => beat.clicks);
  return click !== undefined && seconds >= click.from + HOVER_AT;
}

export type Card = { title: string; status: string; lines: string[]; box: Rect; asked: boolean };
/** The panel laid out in `box`: its title's lines, then a card per part, as many as fit, each as tall as its wrapped title. */
export function layPanel(box: Rect): { title: { lines: string[]; box: Rect }; cards: Card[] } {
  const columns = columnsOf(box.width, SMALL.advance), lines = wrap(PANEL.title, columns);
  const title = { lines, box: { x: box.x + 3, y: box.y + 3, width: Math.max(...lines.map(line => line.length)) * SMALL.advance, height: lines.length * SMALL.line - 1 } };
  const cards: Card[] = [];
  let top = box.y + 3 + lines.length * SMALL.line + 2;
  for (const part of PANEL.parts) {
    const wrapped = wrap(part.title, columns - 1), tall = wrapped.length * SMALL.line + 4;
    if (top + tall > box.y + box.height - 1) break;
    cards.push({ title: part.title, status: part.status, lines: wrapped, box: { x: box.x + 2, y: top, width: box.width - 4, height: tall }, asked: part.title === asked!.title });
    top += tall + 2;
  }
  return { title, cards };
}

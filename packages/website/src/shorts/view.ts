/** Capability 6 · Pixel-art shorts. What the storytree side's developer sees on his map, from the saved snapshot the website
 * already draws, so every name on screen is a real one: the island he clicks (the website's own), the parts its panel lists,
 * the part he asks Claude about, and how the globe turns to face the island in his map beats. */
import type { TourSnapshot } from "../forest-data.js";
import saved from "../forest-snapshot.json" with { type: "json" };
import type { Beat, Grounding } from "./script.js";

export const snapshot = saved as unknown as TourSnapshot;
type Part = { capability: string; title: string; status: string };
type Island = { story: string; title: string; land: { territories: Part[] } };

const islands = snapshot.scene.islands as unknown as Island[];
const spots = new Map(snapshot.spots);

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

/** The globe's turn about its axis, in radians, that brings `story` to face the eye. */
const facing = (story: string) => { const { x, z } = spots.get(story)!; return Math.atan2(-x, z); };
const ease = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
const DRIFT = 0.03, TURN = 1.2;
/** When, into the beat he clicks in, the cursor lands on the island and its panel opens. */
export const CLICK_AT = 1.5, PANEL_AT = 1.8;

/** The globe's angle at `seconds`: it drifts slowly, and in the beat he clicks in it turns, the short way round over TURN
 * seconds, to face the island. */
export function turnAt(beats: readonly Beat[], seconds: number): number {
  let angle = facing(island!.story) - 1.4;
  const click = beats.find(beat => beat.clicks);
  if (click && seconds >= click.from) {
    const target = facing(island!.story) - DRIFT * (click.from + TURN);
    angle += Math.atan2(Math.sin(target - angle), Math.cos(target - angle)) * ease((seconds - click.from) / TURN);
  }
  return angle + DRIFT * seconds;
}

/** Seconds since he clicked the island, or undefined before he has. */
export function clickedFor(beats: readonly Beat[], seconds: number): number | undefined {
  const click = beats.find(beat => beat.clicks);
  return click && seconds >= click.from + CLICK_AT ? seconds - click.from - CLICK_AT : undefined;
}

/** The island lit at `seconds` and how lit, 0 to 1: it lights once he has clicked it. */
export function litAt(beats: readonly Beat[], seconds: number): { story: string; glow: number } | undefined {
  const since = clickedFor(beats, seconds);
  return since === undefined ? undefined : { story: island!.story, glow: ease(since / 0.3) };
}

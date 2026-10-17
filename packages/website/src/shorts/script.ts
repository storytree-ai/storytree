/** Capability 6 · Pixel-art shorts. The first short, "seeing what agents built", as data (the owner's notes of 2026-10-18,
 * question_dd86ec9c0809): the same developer at the same desk on both halves, seen from behind so his screen is the stage.
 * Each beat names his pose, what his screen shows and whether the half cuts to a full view of it. Every position here is
 * in the 320×180 frame's own pixels. */

/** The low-resolution frame every short is drawn at, and the whole number it is scaled up by to 1920×1080. */
export const LOW = { width: 320, height: 180 } as const;
export const SCALE = 6;
/** The pixel font (OFL, committed beside its licence), drawn at its native size: every glyph is 8 pixels wide and tall. */
export const FONT = "Press Start 2P";
export const GLYPH = 8;
/** Line pitch inside a bubble, and the padding between its border and its text. */
export const LINE = 10, PAD = 4;
/** The screen font (font.ts): 3×5 glyphs, 4 pixels apart, on lines 6 pixels apart. */
export const SMALL = { advance: 4, line: 6 } as const;

export type Side = "without" | "with";
/** Where each half starts across the frame. */
export const HALF = { without: 0, with: 160 } as const;
/** A thought bubble's box in its half's own pixels, and the most lines it holds: a strip above the monitor. */
export const BUBBLE = { x: 4, y: 17, width: 152, rows: 2 } as const;
export type Rect = { x: number; y: number; width: number; height: number };
/** The monitor's screen in the room, and in a cut to a full view of it, in a half's own pixels. */
export const SCREEN: Record<View, Rect> = { room: { x: 6, y: 46, width: 108, height: 66 }, full: { x: 4, y: 17, width: 152, height: 160 } };
/** Where the developer's 128×128 cell stands in his half: his wheels on the frame's bottom row. */
export const SEAT = { x: 32, y: 52 } as const;

/** The developer's poses: every one is a sequence of frames in the cast's sheet. "gone" draws only his empty chair. */
export const POSES = ["typing", "scratching", "leaning", "standing", "walking"] as const;
export type Pose = typeof POSES[number] | "gone";
/** The props the scene draws from the same sheet. */
export const PROPS = ["chair"] as const;
export type Prop = typeof PROPS[number];

export type View = "room" | "full";
export type App = "claude" | "code" | "map";
export type Beat = {
  /** Seconds from the start, and the second it ends. */
  from: number; to: number;
  pose: Pose;
  /** What the screen shows, and whether the half cuts to a full view of it. */
  app: App; view?: View;
  /** A thought, in a bubble above his head. */
  think?: string;
  /** What he types to Claude, a character at a time; Claude's reply follows once it is typed. */
  typed?: string; reply?: string;
  /** On the code: the file open. */
  file?: string;
  /** On the map: he clicks the island and its panel opens. */
  clicks?: boolean;
};

/** How long the short runs, in seconds, and the end card's start. */
export const LENGTH = 32;
export const END_CARD = 29;
/** The poster frame, in seconds: the island's panel open on the storytree side while the other digs through code. */
export const POSTER = 9.5;
/** Typing speed, in characters a second: the paragraph pours out, the grounded prompt is picked. */
export const TYPED_PER_SECOND = { without: 60, with: 16 } as const;
/** How long Claude takes to answer once a prompt is typed. */
export const REPLY_AFTER = 0.6;

/** The island the developer opens on the map, and the capability on it he asks about: real names, from the saved snapshot. */
export type Grounding = { island: string; capability: string };

/** The very long description the developer without storytree types to say which part he means. */
export const PARAGRAPH = "ok so the waitlist thing you built. not the page, the part that takes the email after someone hits the button on the"
  + " home page and saves it somewhere, i think it's in src/waitlist or maybe it's in main.ts, there's a function that checks"
  + " the email first? the one with the regex, not the one that sends it. does that part stop the same email being saved twice?";

/** The prompt the developer with storytree types instead: grounded in the names the map showed him. */
export const groundedPrompt = ({ island, capability }: Grounding) => `${island.toLowerCase()} ${capability.toLowerCase()}: does it stop duplicate emails?`;

const OPENING: readonly Beat[] = [
  { from: 0, to: 3.6, pose: "typing", app: "claude", typed: "add a waitlist to the website",
    reply: "done. i built the waitlist: a form, a store and a page. 7 files changed." },
];

/** Both halves, beat by beat. */
export function beats(grounding: Grounding): Record<Side, readonly Beat[]> {
  return {
    without: [
      ...OPENING,
      { from: 3.6, to: 7.5, pose: "typing", app: "code", file: "src/main.ts", think: "what did it build?" },
      { from: 7.5, to: 11, pose: "scratching", app: "code", file: "src/waitlist/store.ts", think: "which part is the form?" },
      { from: 11, to: 13.5, pose: "scratching", app: "code", file: "src/waitlist/check.ts", think: "what calls this?!" },
      { from: 13.5, to: 14.5, pose: "typing", app: "claude", typed: PARAGRAPH },
      { from: 14.5, to: 20.8, pose: "typing", app: "claude", view: "full" },
      { from: 20.8, to: 23.2, pose: "scratching", app: "claude",
        reply: "which do you mean: the check in src/waitlist/check.ts or the handler in main.ts?", think: "uh..." },
      { from: 23.2, to: 25.4, pose: "scratching", app: "code", file: "src/waitlist/check.ts", think: "the check? i think?" },
      { from: 25.4, to: 27.6, pose: "typing", app: "claude", typed: "the check i think",
        reply: "and should it match the email exactly, or ignore case and dots?" },
      { from: 27.6, to: END_CARD, pose: "scratching", app: "code", file: "src/waitlist/store.ts", think: "hang on..." },
    ],
    with: [
      ...OPENING,
      { from: 3.6, to: 4.6, pose: "typing", app: "map" },
      { from: 4.6, to: 8.6, pose: "typing", app: "map", view: "full", clicks: true },
      { from: 8.6, to: 11.2, pose: "leaning", app: "map", think: "looks almost right." },
      { from: 11.2, to: 15.6, pose: "typing", app: "claude", typed: groundedPrompt(grounding),
        reply: "yes: one row per email. a repeat is ignored, but case still counts." },
      { from: 15.6, to: 19, pose: "typing", app: "claude", typed: "good. now build the welcome email.",
        reply: "on it." },
      { from: 19, to: 20, pose: "standing", app: "claude" },
      { from: 20, to: 21.5, pose: "walking", app: "claude" },
      { from: 21.5, to: END_CARD, pose: "gone", app: "claude" },
    ],
  };
}

/** What Claude does on the storytree side once its developer has left the room: one step every WORKING_EVERY seconds. */
export const WORKING = ["edit src/waitlist/store.ts", "run tests: 14 passed", "write src/waitlist/welcome.ts", "run tests: 19 passed",
  "update the map: 5 · waitlist"] as const;
export const WORKING_EVERY = 1.3;

/** The beat playing at `seconds` on a side; past the last it holds the last. */
export function beatAt(side: readonly Beat[], seconds: number): Beat {
  return side.find(beat => seconds >= beat.from && seconds < beat.to) ?? side[side.length - 1]!;
}

/** Words into lines of at most `columns` characters, never splitting a word; a word longer than a line stands alone and overflows. */
export function wrap(text: string, columns: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= columns) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** How many characters fit across a box `width` pixels wide, inside its padding, in the pixel font or the screen font. */
export const columnsOf = (width: number, advance = GLYPH) => Math.floor((width - 2 * PAD) / advance);

export type Laid = { x: number; y: number; width: number; height: number; lines: string[] };
/** A bubble laid out on its side: as wide as its longest line, as tall as its lines, in the frame's own pixels. */
export function layBubble(side: Side, text: string): Laid {
  const lines = wrap(text, columnsOf(BUBBLE.width));
  const width = Math.max(...lines.map(line => line.length)) * GLYPH + 2 * PAD;
  return { x: HALF[side] + BUBBLE.x + BUBBLE.width - width, y: BUBBLE.y, width, height: lines.length * LINE + 2 * PAD - 2, lines };
}

export type Said = { who: "you" | "claude"; text: string };
/** The conversation on a side's Claude screen at `seconds`: every prompt typed so far (the current one as far as it has
 * been typed) and every reply that has come back, in order. On the storytree side, after its developer has gone, Claude's
 * work steps follow. */
export function chatAt(side: Side, script: readonly Beat[], seconds: number): Said[] {
  const said: Said[] = [];
  let ready = 0;
  for (const beat of script) {
    if (beat.from > seconds) break;
    let at = beat.from;
    if (beat.typed) {
      const shown = Math.floor((seconds - beat.from) * TYPED_PER_SECOND[side]);
      said.push({ who: "you", text: beat.typed.slice(0, Math.max(0, shown)) });
      at += beat.typed.length / TYPED_PER_SECOND[side] + REPLY_AFTER;
    }
    if (beat.reply && seconds >= at) said.push({ who: "claude", text: beat.reply });
    if (beat.pose === "gone") ready = beat.from;
  }
  if (ready) for (let step = 0; step < WORKING.length && seconds >= ready + (step + 1) * WORKING_EVERY - 1; step++)
    said.push({ who: "claude", text: WORKING[step]! });
  return said;
}

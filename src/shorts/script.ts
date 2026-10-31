/** Capability 6 · Pixel-art shorts. The first short, "seeing what agents built", as data (the owner's notes of 2026-10-18,
 * question_dd86ec9c0809, and of 2026-10-19, question_325b76dba4ae, polished against increment_ea834305fe2d's bar): the same
 * developer at the same desk on both halves, in the room of the owner's reference. Both ask Claude for a wishlist for the shop.
 * Each beat names his pose, what his screen shows and whether the half cuts to a full view of it; the screen's words are read in
 * the full view, never on the monitor in the room. Every position here is in the 480×270 frame's own pixels. */

/** The low-resolution frame every short is drawn at, and the whole number it is scaled up by to 1920×1080: 1.5 times the room
 * of the first cuts' 320×180 (the owner, 2026-10-19: "i'd 1.5x what every current setting is"), ADR-1084 D1. */
export const LOW = { width: 480, height: 270 } as const;
export const SCALE = 4;
/** The pixel font (OFL, committed beside its licence), drawn at its native size: every glyph is 8 pixels wide and tall. */
export const FONT = "Press Start 2P";
export const GLYPH = 8;
/** Line pitch inside a bubble, and the padding between its border and its text. */
export const LINE = 10, PAD = 4;
/** The screen font (font.ts): 3×5 glyphs, 4 pixels apart, on lines 6 pixels apart. */
export const SMALL = { advance: 4, line: 6 } as const;
/** The strip along the top that names each half. */
export const TITLE = 14;

export type Side = "without" | "with";
/** Where each half starts across the frame, and how wide it is. */
export const HALF = { without: 0, with: 240 } as const;
export const HALF_WIDTH = 240;
/** A thought bubble's box in its half's own pixels, and the most lines it holds: a strip above the monitor. */
export const BUBBLE = { x: 6, y: 18, width: 228, rows: 2 } as const;
export type Rect = { x: number; y: number; width: number; height: number };
/** The monitor's screen: in the room, the box round the room's screen (its mask is in the cast); in a cut to a full view of
 * it, the screen below the bubble strip, in a half's own pixels: 228×214, past 1.5 times the first cuts' 152×128. */
export const SCREEN: Record<View, Rect> = { room: { x: 21, y: 121, width: 40, height: 33 }, full: { x: 6, y: 50, width: 228, height: 214 } };
/** Where the developer's 128×128 cell stands in his half: his hands on the keyboard, his wheels on the floor. */
export const SEAT = { x: -6, y: 90 } as const;
/** How far his chair rolls back as he stands up (right, and down toward the viewer), and how long it takes. */
export const ROLL = { x: 24, y: 10, seconds: 0.5 } as const;

/** The developer's poses: every one is a sequence of frames in the cast's sheet. "gone" draws only his empty chair. None is
 * frustrated: he types, reads with his chin on his fist, leans back, stands up and walks out. */
export const POSES = ["typing", "reading", "leaning", "standing", "walking"] as const;
export type Pose = typeof POSES[number] | "gone";
/** The props the scene draws from the same sheet. */
export const PROPS = ["chair", "room"] as const;
export type Prop = typeof PROPS[number];

export type View = "room" | "full";
/** What the screen shows: Claude Code, the code, the map, or a story's capability graph opened full size from its panel. */
export type App = "claude" | "code" | "map" | "graph";
export type Beat = {
  /** Seconds from the start, and the second it ends. */
  from: number; to: number;
  pose: Pose;
  /** What the screen shows, and whether the half cuts to a full view of it. */
  app: App; view: View;
  /** A thought, in a bubble above the monitor. */
  think?: string;
  /** What he types to Claude, a character at a time, and how fast; Claude's reply follows once it is typed. */
  typed?: string; rate?: number; reply?: string;
  /** On the code: the file open. */
  file?: string;
  /** On the map: he clicks the island and its panel opens. */
  clicks?: boolean;
  /** On the map: it grows from an empty sheet as Claude builds what he asked for. */
  grows?: boolean;
};

/** How long the short runs, in seconds, and the end card's start. */
export const LENGTH = 58;
export const END_CARD = 54;
/** The poster frame, in seconds: the new story's capability graph on the storytree side while the other reads through code. */
export const POSTER = 17;
/** Typing speed, in characters a second: about the same on both halves, so the paragraph takes as long as its length. */
export const TYPED_PER_SECOND = { without: 42, with: 30 } as const;
/** How long Claude takes to answer once a prompt is typed. */
export const REPLY_AFTER = 0.6;
/** How long a viewer needs to read a line: about 2.5 words a second, plus a second to find it. */
export const readingTime = (text: string) => text.split(/\s+/).filter(Boolean).length / 2.5 + 1;

/** The island the developer opens on the map, and the capability on it he asks about: real names, from the saved snapshot. */
export type Grounding = { island: string; capability: string };

/** The very long description the developer without storytree types to say which part he means. It is a wall of words,
 * there to be seen pouring out, not read. */
export const PARAGRAPH = "ok so the wishlist thing you built. not the page with the list, the bit where you press the button on a saved item"
  + " and it goes into the cart. i think it's in src/cart or maybe in the wishlist folder, there's a function that moves it?"
  + " the one that adds it to the cart, not the heart. does that take the item off the list after, or leave it there too?";

/** The prompt the developer with storytree types instead: grounded in the names the map showed him. */
export const groundedPrompt = ({ island, capability }: Grounding) => `${island.toLowerCase()} / ${capability.toLowerCase()}: does it empty the list?`;

/** What both developers ask of a brand-new project (the owner, 2026-10-22: "rather than a project midway, it's the project at
 * the very beginning"). */
export const ASKED = "build me a shop";
const ASKING = { pose: "typing", app: "claude", view: "full", typed: ASKED, rate: 14 } as const;
/** When the storytree side cuts from Claude to its map: once its prompt and Claude's first word have been on screen long enough
 * to read. */
export const TO_MAP = 5.2;

/** Both halves, beat by beat. Both open on Claude in a brand-new project and ask it for the shop. Without storytree the reply
 * says it is done; with it, he watches the map grow from an empty sheet as Claude builds. Then their turns line up and cut
 * together: both open what was built at 10 s, change what they look at
 * at 15.5 s and 19 s, go back to Claude at 22 s, and cut to the room at 41 s and to the screen again at 48 s,
 * the paragraph typed as fast as the short prompt (so it takes its length); and while the one
 * with storytree leaves the room the other is still answering questions. The one without never despairs: he keeps reading,
 * file after file, working out what was built. */
export function beats(grounding: Grounding): Record<Side, readonly Beat[]> {
  return {
    without: [
      { from: 0, to: 1.5, pose: "typing", app: "claude", view: "room" },
      { from: 1.5, to: 10, ...ASKING, reply: "done: your shop, with a cart, checkout and a wishlist. 64 files changed." },
      { from: 10, to: 11, pose: "reading", app: "code", view: "room", file: "src/routes/wishlist.ts" },
      { from: 11, to: 15.5, pose: "reading", app: "code", view: "full", file: "src/routes/wishlist.ts", think: "ok. what did it build?" },
      { from: 15.5, to: 19, pose: "reading", app: "code", view: "full", file: "src/wishlist/store.ts", think: "so this saves the list..." },
      { from: 19, to: 22, pose: "reading", app: "code", view: "full", file: "src/cart/move.ts", think: "and this moves it?" },
      { from: 22, to: 23, pose: "typing", app: "claude", view: "room" },
      { from: 23, to: 32.6, pose: "typing", app: "claude", view: "full", typed: PARAGRAPH, reply: "which one: move in cart, or the button?" },
      { from: 32.6, to: 37.5, pose: "reading", app: "claude", view: "full", think: "let me look." },
      { from: 37.5, to: 38.5, pose: "reading", app: "code", view: "room", file: "src/cart/move.ts" },
      { from: 38.5, to: 41, pose: "reading", app: "code", view: "full", file: "src/cart/move.ts", think: "this one?" },
      { from: 41, to: 42, pose: "typing", app: "claude", view: "room" },
      { from: 42, to: 48, pose: "typing", app: "claude", view: "full", typed: "the cart one i think", rate: 60,
        reply: "and should it stay on the wishlist after?" },
      { from: 48, to: 49, pose: "reading", app: "code", view: "room", file: "src/wishlist/store.ts" },
      { from: 49, to: END_CARD, pose: "reading", app: "code", view: "full", file: "src/wishlist/store.ts", think: "let me check..." },
    ],
    with: [
      { from: 0, to: 1.5, pose: "typing", app: "claude", view: "room" },
      { from: 1.5, to: TO_MAP, ...ASKING, reply: "on it." },
      { from: TO_MAP, to: 10, pose: "typing", app: "map", view: "full", grows: true },
      { from: 10, to: 11, pose: "typing", app: "map", view: "room" },
      { from: 11, to: 15.5, pose: "typing", app: "map", view: "full", clicks: true },
      { from: 15.5, to: 17.4, pose: "typing", app: "graph", view: "full" },
      { from: 17.4, to: 19, pose: "typing", app: "graph", view: "full", think: "looks about right. let me just check one thing." },
      { from: 19, to: 22, pose: "leaning", app: "graph", view: "room", think: "looks about right. let me just check one thing." },
      { from: 22, to: 23, pose: "typing", app: "claude", view: "room" },
      { from: 23, to: 34.5, pose: "typing", app: "claude", view: "full", typed: groundedPrompt(grounding),
        reply: "no: it moves the item to the cart and keeps it on the list. no test yet." },
      { from: 34.5, to: 41, pose: "typing", app: "claude", view: "full", typed: "good. now build sharing a list.", reply: "on it." },
      { from: 41, to: 42.5, pose: "standing", app: "claude", view: "room" },
      { from: 42.5, to: 44.5, pose: "walking", app: "claude", view: "room" },
      { from: 44.5, to: 48, pose: "gone", app: "claude", view: "room" },
      { from: 48, to: END_CARD, pose: "gone", app: "claude", view: "full" },
    ],
  };
}

/** What Claude does on the storytree side once its developer has left the room, seen in the full view of its screen: one step
 * every WORKING_EVERY seconds from just after the cut to it. */
export const WORKING = ["write src/wishlist/share.ts", "write src/wishlist/share.test.ts", "run tests: 31 passed", "update the map: 5 · share link"] as const;
export const WORKING_EVERY = 0.6, WORKING_AFTER = 0.3;

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
  return { x: HALF[side] + BUBBLE.x, y: BUBBLE.y, width, height: lines.length * LINE + 2 * PAD - 2, lines };
}

export type Said = { who: "you" | "claude"; text: string; at: number; done: number; wall?: boolean };
/** The conversation on a side's Claude screen at `seconds`: every prompt typed so far (the current one as far as it has
 * been typed) and every reply that has come back, in order, each with when it started showing and when it was whole. On the
 * storytree side, after its developer has gone, Claude's work steps follow. */
export function chatAt(side: Side, script: readonly Beat[], seconds: number): Said[] {
  const said: Said[] = [];
  let ready = 0;
  for (const beat of script) {
    if (beat.from > seconds) break;
    let at = beat.from;
    if (beat.typed) {
      const rate = beat.rate ?? TYPED_PER_SECOND[side];
      at += beat.typed.length / rate;
      const shown = seconds >= at ? beat.typed.length : Math.floor((seconds - beat.from) * rate);
      said.push({ who: "you", text: beat.typed.slice(0, Math.max(0, shown)), at: beat.from, done: at, ...(beat.typed === PARAGRAPH ? { wall: true } : {}) });
      at += REPLY_AFTER;
    }
    if (beat.reply && seconds >= at) said.push({ who: "claude", text: beat.reply, at, done: at });
    if (beat.pose === "gone" && beat.view === "full" && !ready) ready = beat.from;
  }
  if (ready) for (let step = 0; step < WORKING.length && seconds >= ready + WORKING_AFTER + step * WORKING_EVERY; step++) {
    const at = ready + WORKING_AFTER + step * WORKING_EVERY;
    said.push({ who: "claude", text: WORKING[step]!, at, done: at });
  }
  return said;
}

export type ChatLine = { who: Said["who"]; text: string; mark: boolean; said: number; x: number; y: number };
/** The Claude screen's lines at `seconds` inside `screen`: its title row, then the conversation's last lines that fit, each
 * placed in the frame's pixels and naming the message it belongs to (an index into `chatAt`). */
export function chatLines(side: Side, script: readonly Beat[], seconds: number, screen: Rect): { said: Said[]; lines: ChatLine[]; rows: number } {
  const said = chatAt(side, script, seconds), columns = columnsOf(screen.width, SMALL.advance) - 2;
  const working = beatAt(script, seconds).pose === "gone";
  const all = said.flatMap(({ who, text }, index) => {
    const wrapped = text ? wrap(text, columns) : [""];
    return [...(index ? [{ who, text: "", mark: false, said: index }] : []), ...wrapped.map((line, row) => ({ who, text: line, mark: row === 0, said: index }))];
  });
  const rows = Math.floor((screen.height - 12 - (working ? 2 * SMALL.line : 0)) / SMALL.line);
  // The screen scrolls a line at a time; the tail of a message whose first line has scrolled off is not shown.
  const shown = all.slice(-rows), orphans = shown.findIndex(line => line.mark || !line.text);
  const left = screen.x + 3 + 2 * SMALL.advance;
  return { said, rows, lines: shown.map((line, row) => ({ ...line, x: left, y: screen.y + 11 + row * SMALL.line })).slice(Math.max(0, orphans)) };
}

export type Focus = { text: string; box: Rect };
/** The words a viewer must read at `seconds` on a side, each with its box in the frame's pixels: the thought in its bubble,
 * and on a full view of Claude, every whole message on show that arrived since the cut to it (a prompt still being typed is not
 * yet there to read, one from an earlier view was read then, and the paragraph without storytree is a wall to see, not to read). */
export function focusAt(side: Side, script: readonly Beat[], seconds: number): Focus[] {
  if (seconds >= END_CARD) return [];
  const beat = beatAt(script, seconds), focus: Focus[] = [];
  if (beat.think) {
    const { x, y, width, height } = layBubble(side, beat.think);
    focus.push({ text: beat.think, box: { x, y, width, height } });
  }
  if (beat.app === "claude" && beat.view === "full") {
    const screen = { ...SCREEN.full, x: HALF[side] + SCREEN.full.x }, { said, lines } = chatLines(side, script, seconds, screen);
    let cut = script.indexOf(beat);
    while (cut > 0 && script[cut - 1]!.app === "claude" && script[cut - 1]!.view === "full") cut--;
    const since = script[cut]!.from;
    said.forEach((message, index) => {
      const shown = lines.filter(line => line.said === index && line.text);
      if (message.wall || message.at < since || seconds < message.done || !shown.length || shown.length < wrap(message.text, columnsOf(screen.width, SMALL.advance) - 2).length) return;
      const top = Math.min(...shown.map(line => line.y)), bottom = Math.max(...shown.map(line => line.y)) + 5;
      const right = Math.max(...shown.map(line => line.x + line.text.length * SMALL.advance));
      focus.push({ text: message.text, box: { x: shown[0]!.x, y: top, width: right - shown[0]!.x, height: bottom - top } });
    });
  }
  return focus;
}

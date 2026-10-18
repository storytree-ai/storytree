/** Capability 6 · Pixel-art shorts. The first short, "seeing what agents built", as data (the owner's notes of 2026-10-18,
 * question_dd86ec9c0809, polished against increment_ea834305fe2d's bar): the same developer at the same desk on both halves,
 * in the room of the owner's reference. Each beat names his pose, what his screen shows and whether the half cuts to a full
 * view of it; the screen's words are read in the full view, never on the monitor in the room. Every position here is in the
 * 320×180 frame's own pixels. */

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
/** The strip along the top that names each half. */
export const TITLE = 14;

export type Side = "without" | "with";
/** Where each half starts across the frame. */
export const HALF = { without: 0, with: 160 } as const;
/** A thought bubble's box in its half's own pixels, and the most lines it holds: a strip above the monitor. */
export const BUBBLE = { x: 4, y: 17, width: 152, rows: 2 } as const;
export type Rect = { x: number; y: number; width: number; height: number };
/** The monitor's screen: in the room, the box round the set's screen (its mask is in the cast); in a cut to a full view of
 * it, the screen below the bubble strip, in a half's own pixels. */
export const SCREEN: Record<View, Rect> = { room: { x: 21, y: 83, width: 40, height: 33 }, full: { x: 4, y: 48, width: 152, height: 128 } };
/** Where the developer's 128×128 cell stands in his half: his hands on the keyboard, his wheels on the floor. */
export const SEAT = { x: -6, y: 52 } as const;
/** Where the window hangs on the room's right wall. */
export const WINDOW = { x: 104, y: 44 } as const;

/** The developer's poses: every one is a sequence of frames in the cast's sheet. "gone" draws only his empty chair. */
export const POSES = ["typing", "scratching", "leaning", "standing", "walking"] as const;
export type Pose = typeof POSES[number] | "gone";
/** The props the scene draws from the same sheet. */
export const PROPS = ["chair", "room", "window"] as const;
export type Prop = typeof PROPS[number];

export type View = "room" | "full";
export type App = "claude" | "code" | "map";
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
};

/** How long the short runs, in seconds, and the end card's start. */
export const LENGTH = 56;
export const END_CARD = 52;
/** The poster frame, in seconds: the island's panel open on the storytree side while the other digs through code. */
export const POSTER = 16;
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
export const PARAGRAPH = "ok so the waitlist thing you built. not the page, the part that takes the email after someone hits the button on the"
  + " home page and saves it somewhere, i think it's in src/waitlist or maybe it's in main.ts, there's a function that checks"
  + " the email first? the one with the regex, not the one that sends it. does that part stop the same email being saved twice?";

/** The prompt the developer with storytree types instead: grounded in the names the map showed him. */
export const groundedPrompt = ({ island, capability }: Grounding) => `${island.toLowerCase()} / ${capability.toLowerCase()}: does it stop duplicate emails?`;

const OPENING: readonly Beat[] = [
  { from: 0, to: 1.5, pose: "typing", app: "claude", view: "room" },
  { from: 1.5, to: 10, pose: "typing", app: "claude", view: "full", typed: "add a waitlist to the website", rate: 14,
    reply: "done: a form, a store and a page. 7 files changed." },
];

/** Both halves, beat by beat. Their turns line up: both dig in at 10 s, both go back to Claude at 22 s (the paragraph typed as fast as the short prompt, so it takes its length), and while the one
 * with storytree leaves the room the other is still answering questions. */
export function beats(grounding: Grounding): Record<Side, readonly Beat[]> {
  return {
    without: [
      ...OPENING,
      { from: 10, to: 11, pose: "scratching", app: "code", view: "room", file: "src/main.ts" },
      { from: 11, to: 15, pose: "scratching", app: "code", view: "full", file: "src/main.ts", think: "what did it build?" },
      { from: 15, to: 18.5, pose: "scratching", app: "code", view: "full", file: "src/waitlist/store.ts", think: "which part is the form?" },
      { from: 18.5, to: 22, pose: "scratching", app: "code", view: "full", file: "src/waitlist/check.ts", think: "what calls this?!" },
      { from: 22, to: 23, pose: "typing", app: "claude", view: "room" },
      { from: 23, to: 32.6, pose: "typing", app: "claude", view: "full", typed: PARAGRAPH, reply: "which one: check.ts or the handler in main.ts?" },
      { from: 32.6, to: 36.5, pose: "scratching", app: "claude", view: "full", think: "uh..." },
      { from: 36.5, to: 37.5, pose: "scratching", app: "code", view: "room", file: "src/waitlist/check.ts" },
      { from: 37.5, to: 41, pose: "scratching", app: "code", view: "full", file: "src/waitlist/check.ts", think: "the check, maybe?" },
      { from: 41, to: 42, pose: "typing", app: "claude", view: "room" },
      { from: 42, to: 48, pose: "typing", app: "claude", view: "full", typed: "the check i think", rate: 60,
        reply: "and should it match the email exactly, or ignore case?" },
      { from: 48, to: 49, pose: "scratching", app: "code", view: "room", file: "src/waitlist/store.ts" },
      { from: 49, to: END_CARD, pose: "scratching", app: "code", view: "full", file: "src/waitlist/store.ts", think: "hang on..." },
    ],
    with: [
      ...OPENING,
      { from: 10, to: 11, pose: "typing", app: "map", view: "room" },
      { from: 11, to: 19, pose: "typing", app: "map", view: "full", clicks: true },
      { from: 19, to: 22, pose: "leaning", app: "map", view: "room", think: "looks almost right." },
      { from: 22, to: 23, pose: "typing", app: "claude", view: "room" },
      { from: 23, to: 34.5, pose: "typing", app: "claude", view: "full", typed: groundedPrompt(grounding),
        reply: "yes: one row per email. a repeat is ignored, but case still counts." },
      { from: 34.5, to: 39.5, pose: "typing", app: "claude", view: "full", typed: "good. now build the welcome email.", reply: "on it." },
      { from: 39.5, to: 40.5, pose: "standing", app: "claude", view: "room" },
      { from: 40.5, to: 42, pose: "walking", app: "claude", view: "room" },
      { from: 42, to: 45, pose: "gone", app: "claude", view: "room" },
      { from: 45, to: END_CARD, pose: "gone", app: "claude", view: "full" },
    ],
  };
}

/** What Claude does on the storytree side once its developer has left the room, seen in the full view of its screen: one step
 * every WORKING_EVERY seconds from just after the cut to it. */
export const WORKING = ["edit src/waitlist/store.ts", "write src/waitlist/welcome.ts", "run tests: 19 passed", "update the map: 5 · waitlist"] as const;
export const WORKING_EVERY = 1, WORKING_AFTER = 0.3;

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

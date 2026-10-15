/** Capability 6 · Pixel-art shorts. The first short, "seeing what agents built", as data: the same developer on both halves
 * of the split screen, each beat a pose and a bubble. Each line on the storytree side answers the question beside it, so
 * the contrast carries the story. Every position here is in the 320×180 frame's own pixels. */

/** The low-resolution frame every short is drawn at, and the whole number it is scaled up by to 1920×1080. */
export const LOW = { width: 320, height: 180 } as const;
export const SCALE = 6;
/** The pixel font (OFL, committed beside its licence), drawn at its native size: every glyph is 8 pixels wide and tall. */
export const FONT = "Press Start 2P";
export const GLYPH = 8;
/** Line pitch inside a bubble, and the padding between its border and its text. */
export const LINE = 10, PAD = 4;

export type Side = "without" | "with";
/** Where each half starts across the frame. */
export const HALF = { without: 0, with: 160 } as const;
/** A bubble's box in its half's own pixels, and the most lines it holds. */
export const BUBBLE = { x: 4, y: 19, width: 88, rows: 4 } as const;
/** The terminal each developer types to their agent in, over the bubble's place, in the half's own pixels: narrower on the
 * storytree side, where the inset keeps its corner. */
export const TERMINAL = { without: { x: 4, y: 19, width: 152 }, with: { x: 4, y: 19, width: 88 }, rows: 5 } as const;
/** The corner inset on the storytree side: what the developer is looking at, the forest's real drawing. */
export const INSET = { x: 256, y: 19, width: 60, height: 60 } as const;

/** The developer's poses: every one is a sequence of frames in the cast's sheet. */
export const POSES = ["typing", "thinking", "frustrated", "satisfied", "inspecting", "typing-exact"] as const;
export type Pose = typeof POSES[number];
/** The props the scenes draw from the same sheet. */
export const PROPS = ["desk", "monitor", "mug", "document", "window"] as const;
export type Prop = typeof PROPS[number];

export type Beat = {
  /** Seconds from the start, and the second it ends. */
  from: number; to: number;
  pose: Pose;
  bubble?: { kind: "think" | "say"; text: string };
  /** What the developer types to their agent: shown in a terminal, a character at a time, instead of a bubble. */
  typed?: string;
  /** On the storytree side: which island the developer is looking at lights up (see `lit` in the composition). */
  looks?: "upstream" | "island";
};

/** How long the short runs, in seconds, and the end card's start. */
export const LENGTH = 26;
export const END_CARD = 22.5;
/** The poster frame, in seconds: the island beat, the documents piled up beside it. */
export const POSTER = 13.5;

/** The few exact words the developer grounds their agent in: the name the globe showed them. */
export const groundingWords = (island: string) => `> ${island.replace(/^the /i, "").toLowerCase()} 6.2: tighten`;

/** The paragraph the developer without storytree writes to say which part they mean. */
export const PARAGRAPH = "> no, not that one. the other auth thing, the module the checkout calls before it saves the cart, i think it was moved last week? the one with the retry loop, not the old one. you know the one. it's somewhere under services i think, or maybe lib. the bit that"
  + " handles tokens, not sessions...";

/** Both halves, beat by beat. The storytree side's island name is filled in from the real view by the composition. */
export function beats(island: string): Record<Side, readonly Beat[]> {
  return {
    without: [
      { from: 0, to: 1.5, pose: "typing" },
      { from: 1.5, to: 6, pose: "inspecting", bubble: { kind: "think", text: "what's upstream of this?" } },
      { from: 6, to: 10.5, pose: "thinking", bubble: { kind: "think", text: "what does this do?" } },
      { from: 10.5, to: 15, pose: "frustrated", bubble: { kind: "think", text: "what does this even mean?!" } },
      { from: 15, to: END_CARD, pose: "typing", typed: PARAGRAPH },
    ],
    with: [
      { from: 0, to: 1.5, pose: "typing" },
      { from: 1.5, to: 6, pose: "inspecting", looks: "upstream", bubble: { kind: "think", text: "ah, that's what feeds it." } },
      { from: 6, to: 10.5, pose: "satisfied", bubble: { kind: "think", text: "yeah, that looks right." } },
      { from: 10.5, to: 15, pose: "inspecting", looks: "island", bubble: { kind: "think", text: "about right, but could be better." } },
      { from: 15, to: 18.5, pose: "typing-exact", looks: "island", typed: groundingWords(island) },
      { from: 18.5, to: END_CARD, pose: "satisfied", looks: "island", bubble: { kind: "say", text: "done." } },
    ],
  };
}

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

/** How many characters fit across a box `width` pixels wide, inside its padding. */
export const columnsOf = (width: number) => Math.floor((width - 2 * PAD) / GLYPH);

export type Laid = { x: number; y: number; width: number; height: number; lines: string[] };
/** A bubble laid out on its side: as wide as its longest line, as tall as its lines, in the frame's own pixels. */
export function layBubble(side: Side, text: string): Laid {
  const lines = wrap(text, columnsOf(BUBBLE.width));
  const width = Math.max(...lines.map(line => line.length)) * GLYPH + 2 * PAD;
  return { x: HALF[side] + BUBBLE.x, y: BUBBLE.y, width, height: lines.length * LINE + 2 * PAD - 2, lines };
}

/** The terminal's last `TERMINAL.rows` lines on a side once `typed` has been typed up to `shown` characters. */
export function terminalLines(side: Side, typed: string, shown: number): string[] {
  return wrap(typed.slice(0, shown), columnsOf(TERMINAL[side].width)).slice(-TERMINAL.rows);
}

/**
 * Capability 3 · Feedback record. What crosses between the page and the main process for a feedback note: data only, safe
 * in the sandboxed renderer. The page names the surface and what it shows; the main process adds the story, the app's
 * version, the time and the picture, which never crosses to the page.
 */
import type { DeclaredSurface } from "../naming/resolve.js";

/** Whether the corner is offered here, and the surfaces a note may name. */
export interface FeedbackSetup {
  /** True only where the library holds project storytree, the one notes are written to ("just me for now"). */
  readonly offered: boolean;
  readonly surfaces: readonly DeclaredSurface[];
}

/** A note as the page sends it. */
export interface PageNote {
  readonly text: string;
  readonly surface: string;
  /** The story node or note selected, if any. */
  readonly selection?: string | undefined;
  /** The project on show, if any. */
  readonly project?: string | undefined;
  readonly window: { readonly width: number; readonly height: number };
  readonly theme: "light" | "dark";
}

export interface FeedbackBridge {
  feedbackSetup(): Promise<FeedbackSetup>;
  /** Take a picture of the app's window as it is now, kept in the main process; the token that names it, or none if none was taken. */
  captureForFeedback(): Promise<string | undefined>;
  /** Write the note, with the picture `screenshot` names if given; the record's id once it is written. */
  sendFeedback(note: PageNote, screenshot?: string): Promise<{ id: string }>;
}

export const FEEDBACK_CHANNELS = {
  feedbackSetup: "storytree:feedback-setup",
  captureForFeedback: "storytree:feedback-capture",
  sendFeedback: "storytree:feedback-send",
} as const;

/** The page's side of this story's operations, named in its manifest (`pageChannels`, ADR-1021): the desktop's preload offers them. */
export const feedbackPageChannels = [FEEDBACK_CHANNELS];

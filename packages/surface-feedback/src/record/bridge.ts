// Capability 3 · Feedback record
import type { DeclaredSurface } from "../naming/resolve.js";

export interface FeedbackSetup {
  readonly offered: boolean;
  readonly surfaces: readonly DeclaredSurface[];
}

export const FEEDBACK_PICK_EVENT = "storytree:feedback-pick";

export interface DrawnObject {
  readonly kind: "gate" | "capability" | "island";
  readonly story: string;
  readonly capability?: string;
  readonly between?: [string, string];
  readonly name: string;
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface FeedbackPickDetail {
  readonly x: number;
  readonly y: number;
  answer?: DrawnObject;
}

export interface FeedbackAnchor {
  readonly selector: string;
  readonly tag: string;
  readonly role?: string;
  readonly name?: string;
  readonly text?: string;
  readonly marks: readonly string[];
  readonly components: readonly string[];
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly styles: Readonly<Record<string, string>>;
  readonly html: string;
  readonly drawn?: DrawnObject;
}

export interface PageNote {
  readonly text: string;
  readonly surface: string;
  readonly anchor: FeedbackAnchor;
  readonly selection?: string | undefined;
  readonly project?: string | undefined;
  readonly window: { readonly width: number; readonly height: number };
  readonly theme: "light" | "dark";
}

export interface FeedbackBridge {
  feedbackSetup(): Promise<FeedbackSetup>;
  captureForFeedback(box?: FeedbackAnchor["box"]): Promise<string | undefined>;
  sendFeedback(note: PageNote, screenshot?: string, crop?: string): Promise<{ id: string }>;
}

export const FEEDBACK_CHANNELS = {
  feedbackSetup: "storytree:feedback-setup",
  captureForFeedback: "storytree:feedback-capture",
  sendFeedback: "storytree:feedback-send",
} as const;

export const feedbackPageChannels = [FEEDBACK_CHANNELS];

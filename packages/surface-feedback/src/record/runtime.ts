/**
 * Capability 3 · Feedback record. The main process's side of a feedback note: it takes the picture of the app's own page
 * (webContents.capturePage, so no operating-system screen-recording permission is involved), keeps it under a token
 * until the note is sent, and writes the note into project storytree with the story that declares its surface, the
 * app's version and the time.
 */
import { randomUUID } from "node:crypto";

import type { FeedbackNote, Library, Storytree } from "@storytree/library";

import type { DeclaredSurface } from "../naming/resolve.js";
import { FEEDBACK_CHANNELS, type FeedbackBridge, type FeedbackSetup, type PageNote } from "./bridge.js";

/** The project every note is written to: the owner's own, whichever project is on show ("just me for now"). */
export const FEEDBACK_PROJECT = "storytree";
/** Pictures waiting for their note: a composer opened and closed unsent leaves one, so only the latest few are kept. */
const KEPT_PICTURES = 4;

/** What a host offers this story's page part. */
export interface FeedbackPageFrame {
  readonly appVersion: string;
  /** Every surface the mounted stories declare, with the story declaring it. */
  readonly declaredSurfaces: readonly DeclaredSurface[];
  /** The open library's server, asked at call time: none before the library opens. */
  server(): {
    listProjects: Storytree["listProjects"];
    openProject(name: string, options?: { create?: boolean }): Promise<Pick<Library, "sendFeedback">>;
  } | undefined;
  /** A JPEG of the app's window as it is now, or none when there is no window. */
  captureWindow(): Promise<Uint8Array | undefined>;
}

export function createFeedbackRuntime(frame: FeedbackPageFrame, options: { now?: () => Date } = {}): FeedbackBridge {
  const pictures = new Map<string, Uint8Array>();
  let opened: { server: object; library: Promise<Pick<Library, "sendFeedback">> } | undefined;
  const library = async (): Promise<Pick<Library, "sendFeedback">> => {
    const server = frame.server();
    if (server === undefined || !(await server.listProjects()).includes(FEEDBACK_PROJECT)) {
      throw new Error(`This library holds no project ${FEEDBACK_PROJECT}, where feedback notes are kept.`);
    }
    if (opened?.server !== server) opened = { server, library: server.openProject(FEEDBACK_PROJECT, { create: false }) };
    return opened.library;
  };
  return {
    async feedbackSetup(): Promise<FeedbackSetup> {
      const projects = await frame.server()?.listProjects().catch((): string[] => []);
      return { offered: projects?.includes(FEEDBACK_PROJECT) === true, surfaces: frame.declaredSurfaces };
    },
    async captureForFeedback() {
      const jpeg = await frame.captureWindow().catch(() => undefined);
      if (jpeg === undefined) return undefined;
      const token = randomUUID();
      pictures.set(token, jpeg);
      for (const old of [...pictures.keys()].slice(0, -KEPT_PICTURES)) pictures.delete(old);
      return token;
    },
    async sendFeedback(given: unknown, screenshot?: unknown) {
      const note = noteOf(given, frame.declaredSurfaces, (options.now ?? (() => new Date()))(), frame.appVersion);
      const picture = typeof screenshot === "string" ? pictures.get(screenshot) : undefined;
      const record = await (await library()).sendFeedback(note, { actor: "app:feedback-corner", ...(picture === undefined ? {} : { screenshot: picture }) });
      if (typeof screenshot === "string") pictures.delete(screenshot);
      return { id: record.id };
    },
  };
}

/** The note the page sent, checked, with only its own fields, and what the main process adds. */
function noteOf(given: unknown, surfaces: readonly DeclaredSurface[], at: Date, version: string): FeedbackNote {
  const page = (typeof given === "object" && given !== null ? given : {}) as Partial<Record<keyof PageNote, unknown>>;
  const text = typeof page.text === "string" ? page.text.trim() : "";
  if (text === "") throw new Error("A feedback note needs text.");
  const surface = surfaces.find(({ id }) => id === page.surface);
  if (surface === undefined) throw new Error(`There is no declared surface ${JSON.stringify(page.surface)}: name one of ${surfaces.map(({ id }) => id).join(", ")}.`);
  const size = (typeof page.window === "object" && page.window !== null ? page.window : {}) as Record<string, unknown>;
  const whole = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
  const named = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
  const selection = named(page.selection);
  const project = named(page.project);
  return {
    text,
    surface: surface.id,
    story: surface.story,
    ...(selection === undefined ? {} : { selection }),
    ...(project === undefined ? {} : { project }),
    window: { width: whole(size.width), height: whole(size.height) },
    theme: page.theme === "light" ? "light" : "dark",
    version,
    at: at.toISOString(),
  };
}

/** The main process's side, named in its manifest (`pageAnswers`, ADR-1021): the desktop answers the page's notes with it. */
export const feedbackPageAnswers = [(frame: FeedbackPageFrame) => ({ channels: FEEDBACK_CHANNELS, answers: createFeedbackRuntime(frame) })];

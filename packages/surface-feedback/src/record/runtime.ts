/**
 * Capability 3 · Feedback record. The main process's side of a feedback note: it takes the picture of the app's own page
 * (webContents.capturePage, so no operating-system screen-recording permission is involved), and one cut to the element
 * the note points at, keeps each under a token until the note is sent, and writes the note into project storytree with
 * the element, the story that declares its surface, the app's version and the time.
 */
import { randomUUID } from "node:crypto";

import type { FeedbackNote, Library, Storytree } from "@storytree/library";

import type { DeclaredSurface } from "../naming/resolve.js";
import { HTML_LIMIT } from "../naming/anchor.js";
import { FEEDBACK_CHANNELS, type FeedbackAnchor, type FeedbackBridge, type FeedbackSetup, type PageNote } from "./bridge.js";

/** The project every note is written to: the owner's own, whichever project is on show ("just me for now"). */
export const FEEDBACK_PROJECT = "storytree";
/** Pictures waiting for their note: a composer opened and closed unsent leaves one, so only the latest few are kept. */
const KEPT_PICTURES = 4;
/** Around the element, so the crop shows what it sits beside. */
export const CROP_MARGIN = 16;

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
  /** A JPEG of the app's window as it is now, or of the part `rect` names, in CSS pixels; none when there is no window. */
  captureWindow(rect?: { x: number; y: number; width: number; height: number }): Promise<Uint8Array | undefined>;
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
    async captureForFeedback(box?: unknown) {
      const rect = box === undefined ? undefined : cropOf(box);
      const jpeg = await frame.captureWindow(rect).catch(() => undefined);
      if (jpeg === undefined) return undefined;
      const token = randomUUID();
      pictures.set(token, jpeg);
      for (const old of [...pictures.keys()].slice(0, -KEPT_PICTURES)) pictures.delete(old);
      return token;
    },
    async sendFeedback(given: unknown, screenshot?: unknown, crop?: unknown) {
      const note = noteOf(given, frame.declaredSurfaces, (options.now ?? (() => new Date()))(), frame.appVersion);
      const picture = typeof screenshot === "string" ? pictures.get(screenshot) : undefined;
      // A crop is kept only with its window picture: a dropped picture drops both.
      const cut = picture !== undefined && typeof crop === "string" ? pictures.get(crop) : undefined;
      const record = await (await library()).sendFeedback(note, { actor: "app:feedback-corner", ...(picture === undefined ? {} : { screenshot: picture }), ...(cut === undefined ? {} : { crop: cut }) });
      for (const token of [screenshot, crop]) if (typeof token === "string") pictures.delete(token);
      return { id: record.id };
    },
  };
}

/** The element's box the page sent, widened by the margin and kept inside the window's top-left. */
function cropOf(given: unknown): { x: number; y: number; width: number; height: number } {
  const box = (typeof given === "object" && given !== null ? given : {}) as Record<string, unknown>;
  const [x, y, width, height] = [box.x, box.y, box.width, box.height].map((value) => (typeof value === "number" && Number.isFinite(value) ? value : Number.NaN));
  if ([x, y, width, height].some(Number.isNaN) || width! <= 0 || height! <= 0) throw new Error("A crop needs the element's box: x, y, width and height.");
  const left = Math.max(0, Math.floor(x! - CROP_MARGIN));
  const top = Math.max(0, Math.floor(y! - CROP_MARGIN));
  return { x: left, y: top, width: Math.ceil(x! + width! + CROP_MARGIN) - left, height: Math.ceil(y! + height! + CROP_MARGIN) - top };
}

/** The element the page read, checked field by field: only an anchor's own fields are kept. */
function anchorOf(given: unknown): NonNullable<FeedbackNote["anchor"]> {
  const anchor = (typeof given === "object" && given !== null ? given : undefined) as Partial<Record<keyof FeedbackAnchor, unknown>> | undefined;
  if (anchor === undefined) throw new Error("A feedback note needs the element it is about: pick one.");
  const named = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((one): one is string => typeof one === "string" && one !== "") : []);
  const selector = named(anchor.selector);
  const tag = named(anchor.tag);
  if (selector === undefined || tag === undefined) throw new Error("A feedback note's element needs its selector and tag.");
  const box = (typeof anchor.box === "object" && anchor.box !== null ? anchor.box : {}) as Record<string, unknown>;
  const number = (value: unknown, least = Number.NEGATIVE_INFINITY) => (typeof value === "number" && Number.isFinite(value) ? Math.max(least, value) : 0);
  const styles = typeof anchor.styles === "object" && anchor.styles !== null ? Object.entries(anchor.styles).filter((entry): entry is [string, string] => typeof entry[1] === "string") : [];
  const role = named(anchor.role);
  const name = named(anchor.name);
  const text = named(anchor.text);
  return {
    selector,
    tag,
    ...(role === undefined ? {} : { role }),
    ...(name === undefined ? {} : { name }),
    ...(text === undefined ? {} : { text }),
    marks: strings(anchor.marks),
    components: strings(anchor.components).slice(0, 6),
    box: { x: number(box.x), y: number(box.y), width: number(box.width, 0), height: number(box.height, 0) },
    styles: Object.fromEntries(styles),
    html: typeof anchor.html === "string" ? anchor.html.slice(0, HTML_LIMIT) : "",
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
  const anchor = anchorOf(page.anchor);
  return {
    text,
    surface: surface.id,
    story: surface.story,
    anchor,
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

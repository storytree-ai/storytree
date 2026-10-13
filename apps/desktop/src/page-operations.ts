/**
 * Capability 1 · Lifecycle. How the frame mounts a story's page operations (ADR-0649): the story declares each one once, as
 * a bridge method and the IPC channel it travels on, and the frame builds both sides from that declaration: the page's
 * methods here, and the main process's answers. Data and functions only: safe for the page, the preload and the main process.
 */
import type { AnnotatedTree } from "@storytree/library";

/** A story's page operations: each method of its bridge, and the channel that method travels on. */
export type PageChannels<Bridge> = { readonly [Method in keyof Bridge]: string };

/** The page's side of a story's operations: each method sends its arguments on its channel and resolves to the answer. */
export function pageMethods<Bridge>(channels: PageChannels<Bridge>, invoke: (channel: string, ...args: unknown[]) => Promise<unknown>): Bridge {
  return Object.fromEntries(Object.entries<string>(channels).map(([method, channel]) => [method, (...args: unknown[]) => invoke(channel, ...args)])) as Bridge;
}

/** Where the main process answers a channel: Electron's ipcMain, or a test's stand-in. */
export interface PageHandlers {
  // The event is Electron's, which no answer reads; the arguments are the page's.
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void;
}

/** The main process's side: each declared channel is answered by the same-named method of `answers`, given the page's arguments. */
export function answerPage<Channels extends Readonly<Record<string, string>>>(
  handlers: PageHandlers,
  channels: Channels,
  // The page's arguments arrive untrusted; each answer guards its own, as the stories' actions already do.
  answers: { readonly [Method in keyof Channels]: (...args: never[]) => unknown },
): void {
  for (const [method, channel] of Object.entries(channels)) {
    const answer = answers[method] as (...args: unknown[]) => unknown;
    handlers.handle(channel, (_event: unknown, ...args: unknown[]) => answer.apply(answers, args));
  }
}

/** One story's page channels, as its manifest's `pageChannels` names them: each bridge method and the channel it travels on. */
export type PageChannelMap = Readonly<Record<string, string>>;

/**
 * What the frame offers a story's page part (ADR-1021, ADR-1030 D2): the app's home, its build's version, the open library's
 * reads, the tree the page last read for a project, and where the bundled survey worker is. A part declares the shape it uses itself.
 */
export interface PageFrame {
  readonly home: string;
  readonly appVersion: string;
  /** The open library's reads, asked at call time: a part is made before the library opens, and the library may reopen. */
  library(): {
    projectFolder(project: unknown): Promise<string | undefined>;
    projectTree(project: unknown): Promise<AnnotatedTree>;
    projectImports(project: unknown): Promise<{ folder: string; repository?: string }[]>;
  };
  /** The tree the page last read for the project, if it read one. */
  treeRead(project: unknown): AnnotatedTree | undefined;
  /** The bundled survey worker's file. */
  readonly surveyWorker: string;
}

/** A story's page part, as its manifest's `pageAnswers` names it: given the frame, its channels and the answers to them, or none here. */
export type PagePart = (frame: PageFrame) => { readonly channels: PageChannelMap; readonly answers: object } | undefined;

/** The main process answers every page part's channels, each made with the frame. */
export function answerPageParts(handlers: PageHandlers, parts: readonly PagePart[], frame: PageFrame): void {
  for (const part of parts) {
    const page = part(frame);
    if (page !== undefined) answerPage(handlers, page.channels, page.answers as { readonly [method: string]: (...args: never[]) => unknown });
  }
}

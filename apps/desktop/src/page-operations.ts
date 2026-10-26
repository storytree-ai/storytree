/**
 * Capability 1 · Lifecycle. How the frame mounts a story's page operations (ADR-0649): the story declares each one once, as
 * a bridge method and the IPC channel it travels on, and the frame builds both sides from that declaration: the page's
 * methods here, and the main process's answers. Data and functions only: safe for the page, the preload and the main process.
 */
import type { AnnotatedTree, Library, Storytree } from "@storytree/library";
import { isUnreachable, LIBRARY_UNREACHABLE } from "@storytree/library/connection-error";
import { mount, offSaid, type Composition } from "@storytree/plugin-loader/switch";

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

/** The key of the answer a read gets in place of a rejection when the library cannot be reached: its value is the failure's message. */
export const UNREACHABLE_ANSWER = "storytreeLibraryUnreachable";

/**
 * The page's side of an answer: the unreachable answer becomes a failure whose message begins with the library's fixed
 * words (only an error's message crosses to the page), any other answer unchanged.
 */
export function unreachableSaid(answer: unknown): unknown {
  if (typeof answer === "object" && answer !== null && UNREACHABLE_ANSWER in answer) {
    throw new Error(`${LIBRARY_UNREACHABLE}: ${String((answer as Record<string, unknown>)[UNREACHABLE_ANSWER])}`);
  }
  return answer;
}

/**
 * `handlers`, but a read failing because the library cannot be reached resolves with the unreachable answer instead of
 * rejecting, since Electron logs a rejected handler's whole stack at every poll. `log` is told once as an outage starts and
 * once as it ends, when a channel that failed answers again (one needing no library answering ends nothing). Any other
 * failure rejects as before, said in full.
 */
export function sayOutagesOnce(handlers: PageHandlers, log: (line: string) => void): PageHandlers {
  const failing = new Set<string>();
  return {
    handle(channel, listener) {
      handlers.handle(channel, async (event: unknown, ...args: unknown[]) => {
        try {
          const answer = await listener(event, ...args);
          if (failing.has(channel)) {
            failing.clear();
            log("The library answers again.");
          }
          return answer;
        } catch (error) {
          if (!isUnreachable(error)) throw error;
          const message = error instanceof Error ? error.message : String(error);
          if (failing.size === 0) log(`${LIBRARY_UNREACHABLE} (first failed on ${channel}): ${message} Reads are said unreachable until it answers.`);
          failing.add(channel);
          return { [UNREACHABLE_ANSWER]: message };
        }
      });
    },
  };
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
  /** Every surface the mounted stories declare, switches and named canvases alike, with the story declaring it. */
  readonly declaredSurfaces: readonly DeclaredSurface[];
  /** The open library's server, asked at call time: none before the library opens. */
  server(): { listProjects: Storytree["listProjects"]; openProject(name: string, options?: { create?: boolean }): Promise<Pick<Library, "sendFeedback">> } | undefined;
  /** A JPEG of the app's window as it is now (its own page only), or of the part `rect` names; none when there is no window. */
  captureWindow(rect?: { x: number; y: number; width: number; height: number }): Promise<Uint8Array | undefined>;
}

/** A surface a story declares, by the story (its part's name) that declares it. */
export interface DeclaredSurface {
  readonly id: string;
  readonly name: string;
  readonly story: string;
}

/**
 * Every surface the stories' manifests declare (`surfaces` and `namedSurfaces`), each with the part it came from, but
 * those of a part `off` switches off (ADR-1095): the list a feedback note's surface is named from.
 */
export function declaredSurfaces(compositions: readonly Composition<{ readonly id: string; readonly name: string }>[], off: readonly string[] = []): DeclaredSurface[] {
  return compositions.flatMap((composition) => {
    const switched = new Set(mount(composition, off).off.map(({ part }) => part));
    return composition.parts.flatMap(({ id, name }, index) => {
      const story = composition.owners[index]!;
      return switched.has(story) ? [] : [{ id, name, story }];
    });
  });
}

/** A story's page part, as its manifest's `pageAnswers` names it: given the frame, its channels and the answers to them, or none here. */
export type PagePart = (frame: PageFrame) => { readonly channels: PageChannelMap; readonly answers: object } | undefined;

/** A surface view a factory plugin standing in for a switched-off part adds: the surface, and where the window serves its module. */
export interface PluginView {
  readonly surface: string;
  readonly url: string;
}

/** What the page is offered of the factory plugins standing in for switched-off parts: their page channels and their views. */
export interface PageStandIns {
  readonly channels: readonly PageChannelMap[];
  readonly views: readonly PluginView[];
}

/** The channel the preload asks, before the page loads, for the stand-ins' page channels and views (PageStandIns). */
export const STAND_INS_OFFERED = "storytree:page-stand-ins";

/**
 * The main process answers every page part's channels, each made with the frame, but those of a part `off` switches off
 * (ADR-1095): the page still has their channels, so each is answered with a refusal saying the part is off and how to
 * switch it on, rather than left unanswered. A channel a mounted part answers, as a factory plugin standing in for the
 * part does, is answered by it, not refused.
 */
export function answerPageParts(handlers: PageHandlers, parts: Composition<PagePart>, channels: Composition<PageChannelMap>, frame: PageFrame, off: readonly string[] = []): void {
  const { mounted, off: switched } = mount(parts, off);
  const answered = new Set<string>();
  for (const part of mounted) {
    const page = part(frame);
    if (page === undefined) continue;
    answerPage(handlers, page.channels, page.answers as { readonly [method: string]: (...args: never[]) => unknown });
    for (const channel of Object.values(page.channels)) answered.add(channel);
  }
  for (const each of switched) {
    const refused = () => Promise.reject(new Error(offSaid(each)));
    for (const [index, map] of channels.parts.entries()) {
      if (channels.owners[index] !== each.part) continue;
      for (const channel of Object.values(map)) if (!answered.has(channel)) handlers.handle(channel, refused);
    }
  }
}

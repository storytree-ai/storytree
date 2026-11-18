// Capability 8 · Page bridge
import type { AnnotatedTree, Library, Storytree } from "@storytree/library";
import { isUnreachable, LIBRARY_UNREACHABLE } from "@storytree/library/connection-error";
import { mount, offSaid, type Composition } from "@storytree/plugin-loader/switch";

export type PageChannels<Bridge> = { readonly [Method in keyof Bridge]: string };

export function pageMethods<Bridge>(channels: PageChannels<Bridge>, invoke: (channel: string, ...args: unknown[]) => Promise<unknown>): Bridge {
  return Object.fromEntries(Object.entries<string>(channels).map(([method, channel]) => [method, (...args: unknown[]) => invoke(channel, ...args)])) as Bridge;
}

export interface PageHandlers {
  handle(channel: string, listener: (event: any, ...args: any[]) => unknown): void;
}

export const UNREACHABLE_ANSWER = "storytreeLibraryUnreachable";

export function unreachableSaid(answer: unknown): unknown {
  if (typeof answer === "object" && answer !== null && UNREACHABLE_ANSWER in answer) {
    throw new Error(`${LIBRARY_UNREACHABLE}: ${String((answer as Record<string, unknown>)[UNREACHABLE_ANSWER])}`);
  }
  return answer;
}

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

export function answerPage<Channels extends Readonly<Record<string, string>>>(
  handlers: PageHandlers,
  channels: Channels,
  answers: { readonly [Method in keyof Channels]: (...args: never[]) => unknown },
): void {
  for (const [method, channel] of Object.entries(channels)) {
    const answer = answers[method] as (...args: unknown[]) => unknown;
    handlers.handle(channel, (_event: unknown, ...args: unknown[]) => answer.apply(answers, args));
  }
}

export type PageChannelMap = Readonly<Record<string, string>>;

export interface PageFrame {
  readonly home: string;
  readonly appVersion: string;
  library(): {
    projectFolder(project: unknown): Promise<string | undefined>;
    projectTree(project: unknown): Promise<AnnotatedTree>;
    projectImports(project: unknown): Promise<{ folder: string; repository?: string }[]>;
  };
  treeRead(project: unknown): AnnotatedTree | undefined;
  readonly surveyWorker: string;
  readonly declaredSurfaces: readonly DeclaredSurface[];
  server(): { listProjects: Storytree["listProjects"]; openProject(name: string, options?: { create?: boolean }): Promise<Pick<Library, "sendFeedback">>; ownDatabase: Storytree["ownDatabase"] } | undefined;
  captureWindow(rect?: { x: number; y: number; width: number; height: number }): Promise<Uint8Array | undefined>;
}

export interface DeclaredSurface {
  readonly id: string;
  readonly name: string;
  readonly story: string;
}

export function declaredSurfaces(compositions: readonly Composition<{ readonly id: string; readonly name: string }>[], off: readonly string[] = []): DeclaredSurface[] {
  return compositions.flatMap((composition) => {
    const switched = new Set(mount(composition, off).off.map(({ part }) => part));
    return composition.parts.flatMap(({ id, name }, index) => {
      const story = composition.owners[index]!;
      return switched.has(story) ? [] : [{ id, name, story }];
    });
  });
}

export type PagePart = (frame: PageFrame) => { readonly channels: PageChannelMap; readonly answers: object } | undefined;

export interface PluginView {
  readonly surface: string;
  readonly url: string;
}

export interface PageStandIns {
  readonly channels: readonly PageChannelMap[];
  readonly views: readonly PluginView[];
}

export const STAND_INS_OFFERED = "storytree:page-stand-ins";

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

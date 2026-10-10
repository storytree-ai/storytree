/**
 * Capability 1 · Lifecycle. How the frame mounts a story's page operations (ADR-0649): the story declares each one once, as
 * a bridge method and the IPC channel it travels on, and the frame builds both sides from that declaration: the page's
 * methods here, and the main process's answers. Data and functions only: safe for the page, the preload and the main process.
 */

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

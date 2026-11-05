/**
 * Capability 1 · Lifecycle: how the desktop app stops what it holds. Quitting stops the journey, then the page reads,
 * then the library, then Postgres (contract 1.43): each reads what it stands on before that closes. The desktop's main
 * process hands its parts to this and wires it to Electron.
 */

/** Something the app holds, found when it is needed, and let go of once stopped. */
export interface Held<T> {
  held(): T | undefined;
  letGo?(): void;
}

export interface AppParts {
  backups: Held<{ stop(): void }>;
  journey: Held<{ finish(): Promise<void> }>;
  reads: Held<{ close(): Promise<void> }>;
  library: Held<{ close(): Promise<void> }>;
  postgres: Held<{ stop(): Promise<void> }>;
  /** Says a part that failed to stop; the next part stops all the same. */
  error(line: string): void;
}

export interface AppShutdown {
  /** Stops the app's parts in order. Safe to call more than once: every call answers the first's stop. */
  shutdown(): Promise<void>;
  /** Whether a shutdown has begun. */
  stopping(): boolean;
}

export function appShutdown(parts: AppParts): AppShutdown {
  let shutDown: Promise<void> | undefined;
  const close = async (part: Held<{ close(): Promise<void> }>, what: string): Promise<void> => {
    await part.held()?.close().catch((error: unknown) => parts.error(`closing ${what}: ${messageOf(error)}`));
    part.letGo?.();
  };
  return {
    shutdown() {
      parts.backups.held()?.stop();
      shutDown ??= (async () => {
        await parts.journey.held()?.finish();
        await close(parts.reads, "the projects");
        await close(parts.library, "the library");
        await parts.postgres.held()?.stop().catch((error: unknown) => parts.error(`stopping Postgres: ${messageOf(error)}`));
        parts.postgres.letGo?.();
      })();
      return shutDown;
    },
    stopping: () => shutDown !== undefined,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
